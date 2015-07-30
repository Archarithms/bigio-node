/*
 * Copyright (c) 2015, Archarithms Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 * list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The views and conclusions contained in the software and documentation are those
 * of the authors and should not be interpreted as representing official policies,
 * either expressed or implied, of the FreeBSD Project.
 */

var logger = require('winston');
var utils = require('./utils');
var MeMember = require('./member/me');
var RemoteMember = require('./member/you');
var MemberStatus = require('./member/member-status');
var discovery = require('./mcdiscovery');
var db = require('./member/member-database');
var gossiper = require('./gossiper');
var genericCodec = require('./codec/generic-codec');

var me;

var deliveries = {};
var roundRobinIndex = {};

var shuttingDown = false;

var DeliveryType = {
    // Broadcast messages to all known receives.
    BROADCAST : 0,
    // Send messages to the set of known receives in a round-robin manner.
    ROUND_ROBIN : 1,
    // Send messages to randomly selected receivers.
    RANDOM : 2
};

var defaultConfiguration = {
    protocol: 'tcp',
    encrypt: false,
    ssl: false,
    selfSigned: false,
    maxRetry: 3,
    retryInterval: 3000,
    connectionTimeout: 5000,
    useMulticast: true,
    multicastGroup: '239.0.0.1',
    multicastPort: 8989,
    gossipInterval: 250,
    cleanupInterval: 10000,
    logLevel: 'info'
};

var config;

module.exports = {

    /**
     * Initialize BigIO. This function should be called before any further
     * usage. When the callback is invoked, the BigIO system is initialized
     * and ready for use.
     * @param {Object} params the configuration object (optional).
     * @param {function} cb the callback function.
     */
    initialize: function (params, cb) {
        // No parameters specified
        if(typeof params === 'function' || typeof params === 'undefined') {
            cb = params;
            params = defaultConfiguration;
        } else {
            var keys = Object.keys(defaultConfiguration);
            for(var k in keys) {
                var key = keys[k];
                if(!(key in params)) {
                    params[key] = defaultConfiguration[key];
                }
            }
        }

        config = params;

        logger.level = config.logLevel;

        if(config.logFile) {
            logger.add(logger.transports.File, {
                filename: config.logFile,
                level: config.logLevel
            });
        }

        utils.setConfiguration(config);

        var dataPort = config.dataPort;
        var address;

        function getGossipPort(done) {
            if (!config.gossipPort) {
                logger.debug("Finding a random port for gossiping.");
                utils.getFreePort(function(err, port) {
                    config.gossipPort = port;
                    logger.debug("Using port " + port + " for gossiping.");
                    done();
                });
            } else {
                done();
            }
        }

        function getDataPort(done) {
            if (!config.dataPort) {
                logger.debug("Finding a random port for data.");
                utils.getFreePort(function(err, port) {
                    config.dataPort = port;
                    logger.debug("Using port " + port + " for data.");
                    done();
                });
            } else {
                done();
            }
        }

        getGossipPort(function() {
            getDataPort(function() {
                utils.getIp(function(err, ip) {
                    config.ip = ip;
                    connect(config, cb);
                });
            });
        });

        process.on('SIGINT', function() {
            logger.info("Goodbye");
            require('./bigio').shutdown(function() {
                process.exit();
            });
        });
    },

    /**
     * Shutdown the BigIO system.
     * @param {function} cb the callback.
     */
    shutdown: function (cb) {
        shuttingDown = true;

        var i = 0;
        var keys = [];

        var done = function() {
            if(i == (keys.length - 1)) {
                if(typeof cb === 'function') cb();
            }
        };

        gossiper.shutdown(function() {
            discovery.shutdown(function() {
                keys = Object.keys(db.members);
                for (i = 0; i < keys.length; i++) {
                    db.members[keys[i]].shutdown(done);
                }
            });
        });
    },

    /**
     * Send a message. The parameter object takes the following form:
     * {
     *     // The topic across which to send this message.
     *     topic: "topic name",
     *
     *     // Optional: the partition across which to send this message.
     *     partition: "partition name",
     *
     *     // The actual message to encode and send.
     *     message: { ... },
     *
     *     // Optional: a message type for integration with other languages.
     *     // An example is interfacing with Java. The Java BigIO implementation
     *     // requires a well defined class describing the message.
     *     type: "message type",
     *
     *     // Optional: an offset time if the message should be sent in the
     *     // future. If left out, the message will be sent immediately.
     *     offsetMilliseconds: 1000,
     * }
     *
     * @param {Object} obj the information necessary to send the message.
     */
    send: function (obj) {
        var topic = obj.topic;
        var partition = 'partition' in obj ? obj.partition : '.*';
        var message = obj.message;
        var type = 'type' in obj ? obj.type : '';
        var offsetMilliseconds = 'offset' in obj ? obj.offset : '0';

        var envelope = {};

        envelope.decoded = false;
        if(offsetMilliseconds !== undefined) {
            envelope.executeTime = offsetMilliseconds;
        } else {
            envelope.executeTime = 0;
        }

        envelope.millisecondsSinceMidnight = utils.getMillisecondsSinceMidnight();
        envelope.senderKey = me.ip + ":" + me.gossipPort + ":" + me.dataPort;
        envelope.topic = topic;
        envelope.partition = partition;
        envelope.type = type;
        envelope.encrypted = false;

        var delivery = deliveries[topic];
        if (delivery === undefined) {
            delivery = DeliveryType.BROADCAST;
            deliveries[topic] = delivery;
        }

        var index, member;

        if(delivery === DeliveryType.ROUND_ROBIN) {

            if (db.getRegisteredMembers(topic).length > 0) {

                index = (roundRobinIndex.get(topic) + 1) %
                    db.getRegisteredMembers(topic).size();
                roundRobinIndex[topic] = index;

                member = db.getRegisteredMembers(topic).get(index);

                if (me.equals(member)) {
                    envelope.payload = message;
                    envelope.decoded = true;
                } else {
                    envelope.payload = genericCodec.encode(message);
                    envelope.decoded = false;
                }

                member.send(envelope);
            }
        } else if(delivery === DeliveryType.RANDOM) {

            if (!db.getRegisteredMembers(topic).isEmpty()) {
                index = Math.random() * db.getRegisteredMembers(topic).size();

                member = db.getRegisteredMembers(topic).get(index);

                if (me.equals(member)) {
                    envelope.payload = message;
                    envelope.decoded = true;
                } else {
                    envelope.payload = genericCodec.encode(message);
                    envelope.decoded = false;
                }

                member.send(envelope);
            }
        } else if(delivery == DeliveryType.BROADCAST) {
            var members = db.getRegisteredMembers(topic);

            if (me.equals(member)) {
                envelope.payload = message;
                envelope.decoded = true;
            } else {
                envelope.payload = genericCodec.encode(message);
                envelope.decoded = false;
            }

            for (var key in members) {
                member = members[key].member;
                member.send(envelope);
            }
        }
    },

    /**
     * Add a message listener. The parameter object takes the following form:
     * {
     *     // The name of the topic.
     *     topic: "a topic identifier",
     *
     *     // Optional: the name of the partition.
     *     partition: "some partition",
     *
     *     // The function to be called with a received Message
     *     listener: function(message) { ... },
     *
     *     // Optional: the template structure for received messages
     *     template: { ... }
     * }
     * @param {Object} the parameters of the listener.
     */
    addListener: function (obj) {
        var topic = obj.topic;
        var partition = 'partition' in obj ? obj.partition : '.*';
        var consumer = obj.listener;
        var template = 'template' in obj ? obj.template : undefined;

        db.registerMemberForTopic(topic, partition, me);
        db.addLocalListener(topic, partition, consumer, template);
    },

    /**
     * Add a message interceptor.
     * @param {String} topic the topic on which to add the interceptor.
     * @param {function} interceptor the intercepting function.
     */
    addInterceptor: function (topic, interceptor) {
        db.addInterceptor(topic, interceptor);
    },

    /**
     * Set the delivery type for a topic.
     * @param {String} a topic
     * @param {int} the type of delivery.
     */
    setDeliveryType: function (topic, type) {
        deliveries[topic] = type;
        if (type == DeliveryType.ROUND_ROBIN) {
            roundRobinIndex[topic] = 0;
        }
    }
};

var connect = function(config, cb) {

    if('udp' === config.protocol) {
        logger.info("Running over UDP");
    } else {
        logger.info("Running over TCP");
    }

    me = new MeMember(config);
    me.status = MemberStatus.Alive;
    me.initialize(function() {
        db.updateMemberStatus(me);

        me.addGossipConsumer(function(message) {
            handleGossipMessage(message);
        });

        discovery.initialize(me, config, function() {
            db.initialize(me);
            gossiper.initialize(me, config);
            cb();
        });
    });
};

var handleGossipMessage = function(message) {
    if(shuttingDown) {
        return;
    }

    var senderKey = message.ip + ":" + message.gossipPort + ":" + message.dataPort;
    var updateTags = false;

    var memberKeys = Object.keys(message.members);

    for(var i in memberKeys) {
        var index = memberKeys[i];
        var key = message.members[index];
        var m = db.members[key];

        if(m === undefined) {
            var protocol = config.protocol;
            if("udp" == protocol) {
                logger.debug("Discovered new UDP member through gossip: " + message.ip + ":" + message.gossipPort + ":" + message.dataPort);
            } else {
                logger.debug("Discovered new TCP member through gossip: " + message.ip + ":" + message.gossipPort + ":" + message.dataPort);
            }
            m = new RemoteMember(message.ip, message.gossipPort, message.dataPort, config);
            var values = key.split(":");
            m.ip = values[0];
            m.gossipPort = values[1];
            m.dataPort = values[2];
            if(message.publicKey !== undefined) {
                m.setPublicKey(message.getPublicKey());
            }
            m.initialize();
            m.status = MemberStatus.Alive;
        }

        db.updateMemberStatus(m);

        var memberClock = message.clock[i];
        var knownMemberClock = m.sequence;

        if(memberClock > knownMemberClock) {
            if(key == senderKey) {
                updateTags = true;
            }

            m.sequence = memberClock;
            var topics = [];
            if(message.eventListeners !== undefined && message.eventListeners[key] !== undefined) {
                topics = message.eventListeners[key];
            }

            var toRemove = [];
            var regs = db.getAllRegistrations();
            for(var indx in regs) {
                if(regs[indx].member.equals(m)) {
                    var name = utils.getTopicString(regs[indx].topic, regs[indx].partition);
                    if(!(name in topics)) {
                        toRemove.push(regs[indx]);
                    }
                }
            }
            db.removeRegistrations(toRemove);

            for(indx in topics) {
                var topic = utils.getTopic(topics[indx]);
                var partition = utils.getPartition(topics[indx]);

                var mems = db.getRegisteredMembers(topic);
                var found = false;
                for(var k in mems) {
                    if(m.equals(mems[k].member)) {
                        found = true;
                    }
                }

                if(!found) {
                    db.registerMemberForTopic(topic, partition, m);
                }
            }
        }
    }

    if(updateTags) {
        var tagMember = db.getMember(senderKey);
        tagMember.tags = [];
        for(var tag in message.tags) {
            tagMember.tags.push(tag);
        }
    }
};
