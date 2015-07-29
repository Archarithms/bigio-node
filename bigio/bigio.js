/*
 * Copyright (c) 2014, Archarithms Inc.
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

var winston = require('winston')
var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({ level: 'debug' })
        //new (winston.transports.File)({ filename: 'somefile.log' })
    ]
});

var me;

var deliveries = {};
var roundRobinIndex = {};

var shuttingDown = false;

var utils = require('./utils');
var MeMember = require('./member/me');
var RemoteMember = require('./member/them');
var MemberStatus = require('./member/member-status');
var discovery = require('./mcdiscovery');
var db = require('./member/member-database');
var gossiper = require('./gossiper');
var genericCodec = require('./codec/generic-codec');

var DeliveryType = {
    /**
     * Broadcast messages to all known receives.
     */
    BROADCAST : 0,

    /**
     * Send messages to the set of known receives in a round-robin manner.
     */
    ROUND_ROBIN : 1,

    /**
     * Send messages to randomly selected receivers.
     */
    RANDOM : 2
}

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
    cleanupInterval: 10000
}

var config;

module.exports = {

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

        config = params

        utils.setConfiguration(config);

        var dataPort = config['dataPort'];
        var address;

        function getGossipPort(done) {
            if (!config['gossipPort']) {
                logger.debug("Finding a random port for gossiping.");
                utils.getFreePort(function(err, port) {
                    config['gossipPort'] = port;
                    logger.debug("Using port " + port + " for gossiping.");
                    done();
                });
            } else {
                done();
            }
        }

        function getDataPort(done) {
            if (!config['dataPort']) {
                logger.debug("Finding a random port for data.");
                utils.getFreePort(function(err, port) {
                    config['dataPort'] = port;
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
                    config['ip'] = ip;
                    connect(config, cb);
                });
            });
        });

        process.on('SIGINT', function() {
            logger.info("Goodbye");
            cluster.shutdown(function() {
                process.exit();
            });
        });
    },

    shutdown: function (cb) {
        shuttingDown = true;

        gossiper.shutdown(function() {
            discovery.shutdown(function() {
                var keys = Object.keys(db.members);
                for (var i = 0; i < keys.length; i++) {
                    db.members[keys[i]].shutdown(function() {
                        if(i == (keys.length - 1)) {
                            typeof cb === 'function' && cb();
                        }
                    });
                }
            });
        });
    },

    send: function (obj) {
        var topic = obj['topic'];
        var partition = 'partition' in obj ? obj['partition'] : '.*';
        var message = obj['message'];
        var type = 'type' in obj ? obj['type'] : '';
        var offsetMilliseconds = 'offset' in obj ? obj['offset'] : '0';

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
        if (delivery == undefined) {
            delivery = DeliveryType.BROADCAST;
            deliveries[topic] = delivery;
        }

        if(delivery === DeliveryType.ROUND_ROBIN) {

            if (!(db.getRegisteredMembers(topic).length <= 0)) {

                var index = (roundRobinIndex.get(topic) + 1) %
                    db.getRegisteredMembers(topic).size();
                roundRobinIndex[topic] = index;

                var member = db.getRegisteredMembers(topic).get(index);

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
                var index = Math.random() * db.getRegisteredMembers(topic).size();

                var member = db.getRegisteredMembers(topic).get(index);

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
                var member = members[key].member;
                member.send(envelope);
            }
        }
    },

    addListener: function (obj) {
        var topic = obj['topic'];
        var partition = 'partition' in obj ? obj['partition'] : '.*';
        var consumer = obj['listener'];

        db.registerMemberForTopic(topic, partition, me);
        db.addLocalListener(topic, partition, consumer);
    },

    removeAllListeners: function (topic) {
        db.removeAllLocalListeners(topic);
    },

    listMembers: function () {
        return db.getActiveMembers();
    },

    addInterceptor: function (topic, interceptor) {
        db.addInterceptor(topic, interceptor);
    },

    getMe: function () {
        return me;
    },

    getTags: function () {
        return me.getTags();
    },

    setDeliveryType: function (topic, type) {
        deliveries[topic] = type;
        if (type == DeliveryType.ROUND_ROBIN) {
            roundRobinIndex[topic] = 0;
        }
    }
}

var connect = function(config, cb) {

    if('udp' === config['protocol']) {
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
}

var handleGossipMessage = function(message) {
    if(shuttingDown) {
        return;
    }

    var senderKey = message.ip + ":" + message.gossipPort + ":" + message.dataPort
    var updateTags = false;

    var memberKeys = Object.keys(message.members);

    for(var i in memberKeys) {
        var index = memberKeys[i];
        var key = message.members[index];
        var m = db.members[key];

        if(m == undefined) {
            var protocol = config['protocol'];
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
            if(message.publicKey != undefined) {
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

            for(var indx in topics) {
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
        var m = db.getMember(senderKey);
        m.tags = [];
        for(var tag in message.tags) {
            m.tags.push(tag);
        }
    }
}
