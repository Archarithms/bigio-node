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
var events = require('events');
var MemberStatus = require('./member-status');
var utils = require('../utils');

var me;

/**
 * A class for managing listener registrations.
 *
 * @author Andy Trimble
 */
module.exports = {
    interceptors: {},

    reactor: new events.EventEmitter(),

    map: {},

    templates: {},

    /**
     * Add a topic interceptor.
     *
     * @param topic a topic.
     * @param interceptor an interceptor.
     */
    addInterceptor: function(topic, interceptor) {
        if(this.interceptors[topic] === undefined) {
            this.interceptors[topic] = [];
        }
        this.interceptors[topic].push(interceptor);
    },

    /**
     * Set the current member.
     *
     * @param me the current member.
     */
    initialize: function(me) {
        this.me = me;
    },

    /**
     * Get the current member.
     * @return the current member.
     */
    getMe: function() {
        return me;
    },

    /**
     * Add a listener that is located in the same VM as the current member.
     *
     * @param <T> a message type.
     * @param topic a topic.
     * @param partition a partition.
     * @param listener a listener.
     */
    addLocalListener: function(topic, partition, listener, template) {
        this.reactor.addListener(utils.getTopicString(topic, partition), listener);

        if(template) {
            if(!(topic in this.templates)) {
                this.templates[topic] = template;
            }
        }
    },

    /**
     * Remove all local listeners on a given topic.
     *
     * @param topic a topic.
     */
    removeAllLocalListeners: function(topic) {
        var allRegs = this.map[me];

        if(allRegs !== undefined) {
            var regs = allRegs[topic];

            if(regs !== undefined) {
                logger.debug("Removing " + regs.size() + " registration");
                regs.clear();
            } else {
                logger.debug("No listeners registered for topic " + topic);
            }
        }
    },

    /**
     * Remove topic/partition registrations.
     *
     * @param regs a set of registrations.
     */
    removeRegistrations: function(regs) {
        for(var memberKey in this.map) {
            for(var key in this.map[memberKey]) {
                delete this.map[memberKey][key][regs];
            }
        }
    },

    /**
     * Get all topic/partition registrations.
     *
     * @return the list of all registrations.
     */
    getAllRegistrations: function() {
        var ret = [];

        for(var memberKey in this.map) {
            for(var reg in this.map[memberKey]) {
                for(var indx in this.map[memberKey][reg]) {
                    ret.push(this.map[memberKey][reg][indx]);
                }
            }
        }

        return ret;
    },

    /**
     * Get all members that have at least one listener registered for a given
     * topic.
     *
     * @param topic a topic.
     * @return all members that have at least one registered listener.
     */
    getRegisteredMembers: function(topic) {
        var ret = [];

        for(var member in this.map) {
            for(var regs in this.map[member]) {
                for(var indx in this.map[member][regs]) {
                    var key = this.map[member][regs][indx].topic;
                    if(key == topic) {
                        ret.push(this.map[member][regs][indx]);
                    }
                }
            }
        }

        return ret;
    },

    /**
     * Register a member for a topic-partition.
     *
     * @param topic a topic.
     * @param partition a partition.
     * @param member a member.
     */
    registerMemberForTopic: function(topic, partition, member) {

        var memberKey = member.ip + ':' + member.gossipPort + ':' + member.dataPort;

        if(this.map[memberKey] === undefined) {
            this.map[memberKey] = {};
        }

        if(this.map[memberKey][topic] === undefined) {
            this.map[memberKey][topic]  = [];
        }

        var found = false;
        for(var reg in this.map[memberKey][topic]) {
            var thatMember = this.map[memberKey][topic][reg].member;
            var thatMemberKey = thatMember.ip + ':' + thatMember.gossipPort + ':' + thatMember.dataPort;

            if(String(topic) === String(this.map[memberKey][topic][reg].topic) && String(partition) === String(this.map[memberKey][topic][reg].partition) && memberKey == thatMemberKey) {
                found = true;
                break;
            }
        }

        if(!found) {
            var newReg = {};
            newReg.member = member;
            newReg.topic = String(topic);
            newReg.partition = String(partition);
            this.map[memberKey][topic].push(newReg);
        }
    },

    /**
     * Send a message.
     *
     * @param envelope a message envelope.
     * @throws IOException in case of a sending error.
     */
    send:function(envelope) {
        if(Object.keys(this.interceptors).indexOf(envelope.topic) >= 0) {
            for(var index in this.interceptors[envelope.topic]) {
                envelope = this.interceptors[envelope.topic][index](envelope);
            }
        }

        if(envelope.topic in this.templates) {
            var template = this.templates[envelope.topic];
            var conv = {};
            var keys = Object.keys(template);
            for(var idx in keys) {
                conv[keys[idx]] = envelope.message[idx];
            }
            envelope.message = conv;
        }

        if(envelope.executeTime > 0) {
            setTimeout(function() {
                this.reactor.emit(utils.getTopicString(envelope.topic, envelope.partition), envelope.message);
            }, envelope.executeTime);
        } else if(envelope.executeTime >= 0) {
            this.reactor.emit(utils.getTopicString(envelope.topic, envelope.partition), envelope.message);
        }
    },

    members: {},
    activeMembers: {},
    deadMembers: {},

    clear: function() {
        this.members.clear();
        this.activeMembers.clear();
        this.deadMembers.clear();
    },

    getMember: function(key) {
        return this.members[key];
    },

    getAllMembers: function() {
        var ret = [];
        ret.concat(this.members);
        return ret;
    },

    getActiveMembers: function() {
        var ret = [];
        for(var m in this.activeMembers) {
            ret.push(this.activeMembers[m]);
        }
        return ret;
    },

    getDeadMembers: function() {
        var ret = [];
        for(var m in this.deadMembers) {
            ret.push(this.deadMembers[m]);
        }
        return ret;
    },

    updateMemberStatus: function(member) {
        var key = member.ip + ":" + member.gossipPort + ":" + member.dataPort;

        if(key in this.members) {
            if(key in this.activeMembers && (member.status == MemberStatus.Failed || member.status == MemberStatus.Left || member.status == MemberStatus.Unknown)) {
                delete this.activeMembers[key];
                this.deadMembers[key] = member;
            } else if(key in this.deadMembers && member.status == MemberStatus.Alive) {
                delete this.deadMembers[key];
                this.activeMembers[key] = member;
            }
        } else {
            //logger.info('Adding new member at key ' + key);
            this.members[key] = member;
            if(MemberStatus.Alive == member.status) {
                this.activeMembers[key] = member;
            } else {
                this.deadMembers[key] = member;
            }
        }
    }
};
