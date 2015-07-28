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

var PROTOCOL_PROPERTY = "io.bigio.protocol";
var DEFAULT_PROTOCOL = "tcp";
var GOSSIP_PORT_PROPERTY = "io.bigio.port.gossip";
var DATA_PORT_PROPERTY = "io.bigio.port.data";

var winston = require('winston')
var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({ level: 'debug' })
        //new (winston.transports.File)({ filename: 'somefile.log' })
    ]
});

var me; // type MeMember

var deliveries = {}; // type Map<String, DeliveryType>
var roundRobinIndex = {}; // type Map<String, Integer>

var shuttingDown = false;

var config = require('./config');
var utils = require('./utils');
var MeMember = require('./member/me-member');
var RemoteMember = require('./member/remote-member');
var MemberStatus = require('./member/member-status');
var MemberHolder = require('./member/member-holder');
var discovery = require('./mcdiscovery');
var registry = require('./member/listener-registry');
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

module.exports = {

    initialize: function (cb) {
        var protocol = config.getInstance().getProperty(PROTOCOL_PROPERTY, DEFAULT_PROTOCOL);
        var gossipPort = config.getInstance().getProperty(GOSSIP_PORT_PROPERTY);
        var dataPort = config.getInstance().getProperty(DATA_PORT_PROPERTY);
        var address;

        if (gossipPort == null) {
            logger.debug("Finding a random port for gossiping.");
            gossipPort = utils.getFreePort(function (err, port) {
                gossipPort = port;
                logger.debug("Using port " + gossipPort + " for gossiping.");

                if (dataPort == null) {
                    logger.debug("Finding a random port for data.");
                    dataPort = utils.getFreePort(function (err, port) {
                        dataPort = port;
                        logger.debug("Using port " + dataPort + " for data.");
                        utils.getIp(function (err, ip) {
                            address = ip;
                            logger.debug("Greetings. I am " + address + ":" + gossipPort + ":" + dataPort);
                            connect(protocol, address, gossipPort, dataPort, cb);
                        });
                    });
                }
            });
        }

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
                var keys = Object.keys(MemberHolder.members);
                for (var i = 0; i < keys.length; i++) {
                    MemberHolder.members[keys[i]].shutdown(function() {
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

            if (!(registry.getRegisteredMembers(topic).length <= 0)) {

                var index = (roundRobinIndex.get(topic) + 1) %
                    registry.getRegisteredMembers(topic).size();
                roundRobinIndex[topic] = index;

                var member = registry.getRegisteredMembers(topic).get(index);

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

            if (!registry.getRegisteredMembers(topic).isEmpty()) {
                var index = Math.random() * registry.getRegisteredMembers(topic).size();

                var member = registry.getRegisteredMembers(topic).get(index);

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
            var members = registry.getRegisteredMembers(topic);

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

        registry.registerMemberForTopic(topic, partition, me);
        registry.addLocalListener(topic, partition, consumer);
    },

    removeAllListeners: function (topic) {
        registry.removeAllLocalListeners(topic);
    },

    listMembers: function () {
        return MemberHolder.getActiveMembers();
    },

    addInterceptor: function (topic, interceptor) {
        registry.addInterceptor(topic, interceptor);
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

var connect = function(protocol, address, gossipPort, dataPort, cb) {

    if("udp" == protocol) {
        logger.info("Running over UDP");
        me = new MeMember(address, gossipPort, dataPort, false);
    } else {
        logger.info("Running over TCP");
        me = new MeMember(address, gossipPort, dataPort, true);
    }

    me.status = MemberStatus.Alive;
    me.initialize(function() {
        MemberHolder.updateMemberStatus(me);

        me.addGossipConsumer(function(message) {
            handleGossipMessage(message);
        });

        discovery.initialize(me, function() {
            registry.initialize(me);

            gossiper.initialize(me);

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
        var m = MemberHolder.members[key];

        if(m == undefined) {
            var protocol = config.getInstance().getProperty(PROTOCOL_PROPERTY, DEFAULT_PROTOCOL);
            if("udp" == protocol) {
                logger.debug("Discovered new UDP member through gossip: " + message.ip + ":" + message.gossipPort + ":" + message.dataPort);
                m = new RemoteMember(message.ip, message.gossipPort, message.dataPort, false);
            } else {
                logger.debug("Discovered new TCP member through gossip: " + message.ip + ":" + message.gossipPort + ":" + message.dataPort);
                m = new RemoteMember(message.ip, message.gossipPort, message.dataPort, true);
            }
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

        MemberHolder.updateMemberStatus(m);

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
            var regs = registry.getAllRegistrations();
            for(var indx in regs) {
                if(regs[indx].member.equals(m)) {
                    var name = utils.getTopicString(regs[indx].topic, regs[indx].partition);
                    if(!(name in topics)) {
                        toRemove.push(regs[indx]);
                    }
                }
            }
            registry.removeRegistrations(toRemove);

            for(var indx in topics) {
                var topic = utils.getTopic(topics[indx]);
                var partition = utils.getPartition(topics[indx]);

                var mems = registry.getRegisteredMembers(topic);
                var found = false;
                for(var k in mems) {
                    if(m.equals(mems[k].member)) {
                        found = true;
                    }
                }

                if(!found) {
                    registry.registerMemberForTopic(topic, partition, m);
                }
            }
        }
    }

    if(updateTags) {
        var m = MemberHolder.getMember(senderKey);
        m.tags = [];
        for(var tag in message.tags) {
            m.tags.push(tag);
        }
    }
}
