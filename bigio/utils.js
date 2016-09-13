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
var net = require('net');
var os = require('os');

var OperatingSystem = {
    WIN_64 : 0, WIN_32 : 1, LINUX_64 : 2, LINUX_32 : 3, MAC_64 : 4, MAC_32 : 5
};

var nic, inetAddress, ip;

var START_PORT = 32768;
var END_PORT = 65536;
var NUM_CANDIDATES = END_PORT - START_PORT + 1;
var port;

var config;

module.exports = {

    ALL_PARTITIONS: ".*",

    setConfiguration: function(cfg) {
        config = cfg;
    },

    getTopicString: function(topic, partition) {
        return topic + "(" + partition + ")";
    },

    getNotifyTopicString: function(topic, partition) {
        return topic + partition;
    },

    getTopic: function(topicPartition) {
        if(String(topicPartition).indexOf('(') > -1) {
            return topicPartition.split("\\(")[0];
        }
        return topicPartition;
    },

    getPartition: function(topicPartition) {
        if(String(topicPartition).indexOf('(') > -1) {
            var spl = topicPartition.split("\\(");
            if (spl.length > 1) {
                return spl[1];
            }
        }

        return this.ALL_PARTITIONS;
    },

    getMillisecondsSinceMidnight: function() {
        var now = new Date(),
        then = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            0,0,0);
        var diff = now.getTime() - then.getTime();

        return diff;
    },

    getKey: function(args) {
        if(args.member) {
            return String(args.member.ip) + ':' + String(args.member.gossipPort) + ':' + String(args.member.dataPort);
        } else if(args.ip && args.gossipPort && args.dataPort) {
            return String(args.ip) + ':' + String(args.gossipPort) + ':' + String(args.dataPort);
        }
        return '';
    },

    getIp: function (cb) {
      if (ip === undefined) {
        var match;
        var interfaces = os.networkInterfaces();
        if (config.network === undefined) {
          switch (currentOS()) {
          case OperatingSystem.WIN_64:
          case OperatingSystem.WIN_32:
            match = "Loopback";
            break;
          case OperatingSystem.LINUX_64:
          case OperatingSystem.LINUX_32:
            match = "lo";
            break;
          case OperatingSystem.MAC_64:
          case OperatingSystem.MAC_32:
            match = "lo0";
            break;
          default:
            logger.error("Cannot determine operating system. Cluster cannot form.");
          }
        } else {
          match = config.network;
        }
        for (var intfc in interfaces) {
          if (intfc.indexOf(match) > -1) {
            for (var i in interfaces[intfc]) {
              if (interfaces[intfc][i].family == 'IPv4') {
                ip = interfaces[intfc][i].address;
              }
            }
          }
        }
      }

      cb(null, ip);
    },

    getFreePort: function(cb) {
        port = Math.floor(Math.random() * NUM_CANDIDATES + START_PORT);
        nextPort(cb);
    }
};

var nextPort = function(cb) {
    var server = net.createServer();

    server.listen(port, function(err) {
        server.once('close', function() {
            cb(null, port);
        });
        server.close();
    });
    server.on('error', function(err) {
        port = Math.floor(Math.random() * NUM_CANDIDATES + START_PORT);
        nextPort(cb);
    });
};

var currentOS = function() {
    var osName = os.platform();
    var osArch = os.arch();

    var ret;

    if (osName == "win32") {
        if (osArch == "x64") {
            ret = OperatingSystem.WIN_64;
        } else {
            ret = OperatingSystem.WIN_32;
        }
    } else if (osName == "linux") {
        if (osArch == "x64") {
            ret = OperatingSystem.LINUX_64;
        } else {
            ret = OperatingSystem.LINUX_32;
        }
    } else {
        if (osArch == "x64") {
            ret = OperatingSystem.MAC_64;
        } else {
            ret = OperatingSystem.MAC_32;
        }
    }

    return ret;
};
