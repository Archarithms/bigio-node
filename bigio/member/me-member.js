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
var events = require('events');
var MemberStatus = require('./member-status');
var parameters = require('../parameters');
var registry = require('./listener-registry');
var envelopeCodec = require('../codec/envelope-codec');
var gossipCodec = require('../codec/gossip-codec');
var genericCodec = require('../codec/generic-codec');

var gossipReactor = new events.EventEmitter();

var SSL_PROPERTY = "io.bigio.ssl";
var DEFAULT_SSL = false;
var SSL_SELFSIGNED_PROPERTY = "io.bigio.ssl.selfSigned";
var DEFAULT_SELFSIGNED = true;
var SSL_CERTCHAINFILE_PROPERTY = "io.bigio.ssl.certChainFile";
var DEFAULT_CERTCHAINFILE = "conf/certChain.pem";
var SSL_KEYFILE_PROPERTY = "io.bigio.ssl.keyFile";
var DEFAULT_KEYFILE = "conf/keyfile.pem";
var SSL_KEYPASSWORD_PROPERTY = "io.bigio.ssl.keyPassword";

var ENCRYPTION_PROPERTY = "io.bigio.encryption";
var DEFAULT_ENCRYPTION = false;

var GOSSIP_TOPIC = "__gossiper";
var DECODE_TOPIC = "__decoder";

var symmetricCipher = undefined;
var rsaCipher = undefined;
var keyPair = undefined;

var useEncryption = parameters.getInstance().getProperty(ENCRYPTION_PROPERTY, DEFAULT_ENCRYPTION);
var useSSL = parameters.getInstance().getProperty(SSL_PROPERTY, DEFAULT_SSL);
var useSelfSigned = parameters.getInstance().getProperty(SSL_SELFSIGNED_PROPERTY, DEFAULT_SELFSIGNED);
var certChainFile = parameters.getInstance().getProperty(SSL_CERTCHAINFILE_PROPERTY, DEFAULT_CERTCHAINFILE);
var keyFile = parameters.getInstance().getProperty(SSL_KEYFILE_PROPERTY, DEFAULT_KEYFILE);
var keyPassword = parameters.getInstance().getProperty(SSL_KEYPASSWORD_PROPERTY);

var gossipServer;
var dataServer;

var MeMember = function(ip, gossipPort, dataPort, useTCP) {
    this.ip = ip;
    this.dataPort = dataPort;
    this.gossipPort = gossipPort;
    this.useTCP = useTCP;
};

MeMember.prototype.tags = {};
MeMember.prototype.sequence = 0;
MeMember.prototype.status = MemberStatus.Unknown;
MeMember.prototype.ip = '';
MeMember.prototype.dataPort = -1;
MeMember.prototype.gossipPort = -1;
MeMember.prototype.useTCP = true;
MeMember.prototype.publicKey = undefined;

MeMember.prototype.toString = function() {
    var ret = "\nMember ";
    ret += this.ip;
    ret += ":";
    ret += this.gossipPort;
    ret += ":";
    ret += this.dataPort;
    if (this.status == MemberStatus.Alive || this.status == MemberStatus.Unknown) {
        ret += "\n    is ";
    } else {
        ret += "\n    has ";
    }
    ret += this.status;

    ret += "\n    with properties";
    for (var key in this.tags) {
        ret += "\n        ";
        ret += key;
        ret += " -> ";
        ret += this.tags[key];
    }

    ret += "\n";

    return ret;
};

MeMember.prototype.equals = function(obj) {
    var them = obj;

    return them !== undefined
        && them.ip === this.ip
        && them.gossipPort === this.gossipPort
        && them.dataPort === this.dataPort;
};

MeMember.prototype.gossip = function(message) {

};

MeMember.prototype.shutdown = function(cb) {
    /* gossipServer.close(function(err) {
        console.log(err);
        dataServer.close(function(err) {
            console.log(err);
            typeof cb === 'function' && cb();
        });
    }); */
    typeof cb === 'function' && cb();
};

MeMember.prototype.initialize = function(cb) {
    logger.debug("Initializing gossip server on " + this.ip + ":" + this.gossipPort);

    var gossipListening = false;
    var dataListening = false;

    if (this.useSSL) {
        logger.info("Using SSL/TLS.");
    } else if(this.useTCP) {
        var net = require('net');

        var self = this;

        gossipServer = net.createServer(function(sock) {
            logger.debug('TCP gossip server connected');

            sock.on('end', function() {
                logger.debug('TCP gossip server disconnected');
            });

            sock.on('error', function(err) {

            });

            sock.on('data', function(data) {
                var message = gossipCodec.decode(data);
                gossipReactor.emit('gossip', message);
            });
        });

        gossipServer.listen(this.gossipPort, '0.0.0.0', function() {
            logger.info('Gossip server listening');
            if(dataListening) {
                cb();
            } else {
                gossipListening = true;
            }
        });

        dataServer = net.createServer(function(conn) {
            logger.debug('TCP data client connected');
            var waitingOn = 0;

            conn.on('end', function() {
                logger.debug('TCP data client disconnected');
            });

            conn.on('error', function(err) {

            });

            conn.on('data', function(data) {
                var bl = require('bl');
                var buff = bl(data);
                var offset = 0;

                if(waitingOn > 0) {
                    var b = require('bl')();
                    b.append(chunk);
                    b.append(buff.slice(0, waitingOn));
                    var m = envelopeCodec.decode(b.slice());
                    if(m !== undefined) {
                        m.decoded = false;
                        self.send(m);
                    } else {
                        logger.error('Bad combined frame');
                    }
                    offset = waitingOn;
                }

                while(offset < buff.length) {
                    var size = buff.get(offset) << 8 | buff.get(offset + 1);
                    offset += 2;
                    if(size + offset > buff.length) {
                        chunk = buff.slice(offset);
                        waitingOn = size - (buff.length - offset);
                        break;
                    } else {
                        var sliced = buff.slice(offset, offset + size);
                        var message = envelopeCodec.decode(sliced);
                        if(message !== undefined) {
                            message.decoded = false;
                            self.send(message);
                        }
                        offset += size;
                        waitingOn = 0;
                    }
                }
            });
        });

        dataServer.listen(this.dataPort, '0.0.0.0', function() {
            if(gossipListening) {
                cb();
            } else {
                dataListening = true;
            }
        });

    } else {
        var dgram = require('dgram');

        var self = this;

        gossipServer = dgram.createSocket('udp4');

        gossipServer.on('listening', function () {
            logger.debug('UDP gossip server connected');
            if(dataListening) {
                cb();
            } else {
                gossipListening = true;
            }
        });
        gossipServer.on('end', function () {
            logger.debug('UDP gossip server disconnected');
        });
        gossipServer.on('error', function (err) {

        });
        gossipServer.on('message', function (msg, rinfo) {
            var message = gossipCodec.decode(msg);
            gossipReactor.emit('gossip', message);
        });

        gossipServer.bind(this.gossipPort, this.ip);

        dataServer = dgram.createSocket('udp4');

        dataServer.on('listening', function () {
            logger.debug('UDP data server connected');
            if(gossipListening) {
                cb();
            } else {
                dataListening = true;
            }
        });
        dataServer.on('end', function () {
            logger.debug('UDP data server disconnected');
        });
        dataServer.on('error', function (err) {

        });
        dataServer.on('message', function (data, rinfo) {
            var message = envelopedecoder.decode(data);
            message.decoded = false;
            self.send(message);
        });

        dataServer.bind(this.dataPort, this.ip);
    }

    if(this.useEncryption) {
        logger.info("Requiring encrypted message traffic.");
    }
};

MeMember.prototype.addGossipConsumer = function(consumer) {
    gossipReactor.addListener('gossip', consumer);
}

MeMember.prototype.send = function(envelope) {
    if(!envelope.decoded) {
        if(envelope.encrypted) {
            log.error('Encrypted messages not supported yet.');
        }

        // decode message
        envelope.message = genericCodec.decode(envelope.payload);
        //envelope.message = envelope.payload;
        envelope.decoded = true;
    }

    registry.send(envelope);
};

module.exports = MeMember;
