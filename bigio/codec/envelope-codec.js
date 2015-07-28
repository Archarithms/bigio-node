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

var logger = require('winston');
var bops = require('bops');
var bl = require('bl');
var msgpack = require('msgpack5')();

/**
 * This is a class for decoding gossip messages.
 *
 * @author Andy Trimble
 */
module.exports = {

    /**
     * Decode a message.
     *
     * @param bytes the raw message.
     * @return the decoded message.
     * @throws IOException in case of an error in decoding.
     */
    decode: function(bytes) {
        var message = {};

        var buff = bl(bytes);
        //buff.consume(2);
        var unpacked = [];

        while(buff.length > 0) {
            try {
                unpacked.push(msgpack.decode(buff));
            } catch(err) {
                logger.warn('Error decoding message');
                logger.warn(err);
                break;
            }
        }

        var index = 0;

        var ip = unpacked[index++] + '.' + unpacked[index++] + '.' + unpacked[index++] + '.' + unpacked[index++];
        var gossipPort = unpacked[index++];
        var dataPort = unpacked[index++];

        message.senderKey = ip + ':' + gossipPort + ':' + dataPort;

        var encrypted = unpacked[index++];
        message.isEncrypted = encrypted;

        if(encrypted === "true") {
            logger.info("Message encrypted");
            message.key = unpacked[index++];
        }

        message.executeTime = unpacked[index++];
        message.millisecondsSinceMidnight = unpacked[index++];
        message.topic = unpacked[index++];
        message.partition = unpacked[index++];
        message.type = unpacked[index++];
        try {
            message.payload = bops.from(unpacked[index], encoding="utf8");
        } catch(err) {
            logger.warn('Could not unpack payload');
            return undefined;
        }

        return message;
    },

    /**
     * Encode a message envelope.
     *
     * @param message a message to encode.
     * @return the encoded message.
     * @throws IOException in case of an encode error.
     */
    encode: function(message) {

        var keys = message.senderKey.split(':');
        var ip = keys[0].split('.');

        if(message.isEncrypted) {
            var toPack = [
                msgpack.encode(parseInt(ip[0])),
                msgpack.encode(parseInt(ip[1])),
                msgpack.encode(parseInt(ip[2])),
                msgpack.encode(parseInt(ip[3])),
                msgpack.encode(parseInt(keys[1])),
                msgpack.encode(parseInt(keys[2])),
                msgpack.encode(true),
                msgpack.encode(message.key),
                msgpack.encode(message.executeTime),
                msgpack.encode(message.millisecondsSinceMidnight),
                msgpack.encode(message.topic),
                msgpack.encode(message.partition),
                msgpack.encode(message.type),
                msgpack.encode(message.payload)
            ];
        } else {
            var toPack = [
                msgpack.encode(parseInt(ip[0])),
                msgpack.encode(parseInt(ip[1])),
                msgpack.encode(parseInt(ip[2])),
                msgpack.encode(parseInt(ip[3])),
                msgpack.encode(parseInt(keys[1])),
                msgpack.encode(parseInt(keys[2])),
                msgpack.encode(false),
                msgpack.encode(parseInt(message.executeTime)),
                msgpack.encode(parseInt(message.millisecondsSinceMidnight)),
                msgpack.encode(message.topic),
                msgpack.encode(message.partition),
                msgpack.encode(message.type),
                msgpack.encode(message.payload)
            ];
        }

        var buff = bops.join(toPack);

        var newBuff = bops.create(buff.length + 2);
        bops.copy(buff, newBuff, 2, 0, buff.length);
        bops.writeUInt16BE(newBuff, buff.length, 0);

        return newBuff;
    }
};
