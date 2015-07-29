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
var gossipCodec = require('./codec/gossip-codec');
var db = require('./member/member-database');
var MemberStatus = require('./member/member-status');
var RemoteMember = require('./member/remote-member');
var utils = require('./utils');
var dgram = require('dgram');

var me;
var server;
var client;

var enabled, multicastGroup, multicastPort, protocol, nic;

module.exports = {

    shutdown: function(cb) {
        client.close();
        cb();
    },

    setupNetworking: function(cb) {

        server = dgram.createSocket('udp4');
        client = dgram.createSocket('udp4');

        client.on('message', function (data, rinfo) {

            var message = gossipCodec.decode(data);

            var key = message.ip + ":" + message.gossipPort + ":" + message.dataPort;

            var member = db.getMember(key);

            if (member == undefined) {
                if ("udp" == protocol) {
                    logger.debug("Discovered new UDP member: " + message.ip + ":" + message.gossipPort + ":" + message.dataPort);
                    member = new RemoteMember(message.ip, message.gossipPort, message.dataPort, false);
                    member.status = MemberStatus.Alive;
                } else {
                    logger.debug("Discovered new TCP member: " + message.ip + ":" + message.gossipPort + ":" + message.dataPort);
                    member = new RemoteMember(message.ip, message.gossipPort, message.dataPort, true);
                    member.status = MemberStatus.Alive;
                }

                if (message.publicKey != undefined) {
                    member.publicKey = message.publicKey;
                }

                member.initialize();
            } else {
                logger.debug("Found known member: " + message.ip + ":" + message.gossipPort + ":" + message.dataPort);
            }

            for (var k in message.tags) {
                member.tags[k] = message.tags[k];
            }

            db.updateMemberStatus(member);
        });

        client.on('listening', function () {
            logger.info('Listening on MC port ' + multicastPort + ' and group ' + multicastGroup);
        });

        client.on('error', function (err) {
            logger.error('MC Discovery Error:\n' + err.stack);
        });


        client.bind(multicastPort, function () {
            client.addMembership(multicastGroup, nic);
            client.setBroadcast(true);
            client.setMulticastTTL(1);

            announce();
            cb();
        });
    },

    initialize: function(_me, config, cb) {
        me = _me;

        enabled = config['useMulticast'];
        multicastGroup = config['multicastGroup'];
        multicastPort = config['multicastPort'];
        protocol = config['protocol'];
        nic = config['nic'];

        this.setupNetworking(cb);
    }
};

var announce = function() {
    logger.info("Announcing");
    var message = {};
    message.clock = [];
    message.tags = {};

    message.ip = me.ip;
    message.gossipPort = me.gossipPort;
    message.dataPort = me.dataPort;
    message.millisecondsSinceMidnight = utils.getMillisecondsSinceMidnight();
    for (var key in me.tags) {
        message.tags[key] = me.tags[key];
    }
    message.members = [me.ip + ":" + me.gossipPort + ":" + me.dataPort];
    me.sequence += 1;
    message.clock.push(me.sequence);
    message.publicKey = me.publicKey;
    message.eventListeners = {};

    var bytes = new Buffer(gossipCodec.encode(message));
    server.send(bytes, 0, bytes.length, multicastPort, multicastGroup, function() {
        server.close();
    });
};
