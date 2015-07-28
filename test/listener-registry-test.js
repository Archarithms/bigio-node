var chai = require('chai');
var assert = chai.assert;
var expect = chai.expect;
var utils = require('../bigio/utils');
var registry = require('../bigio/member/listener-registry');
var me_member = require('../bigio/member/me-member');
var MemberStatus = require('../bigio/member/member-status');

function intercept() { }
function listener() { }

describe('listener-registry', function() {
    me = new me_member('127.0.0.1', 9999, 9998, true);
    registry.initialize(me);
    key = utils.getKey({ member: me });

    describe('#interceptors', function() {
        it('should store interceptors', function() {
            registry.addInterceptor('test', intercept);
            expect(registry.interceptors).to.have.property('test');
            expect(registry.interceptors['test']).to.have.length(1);
            expect(registry.interceptors['test'][0]).to.equal(intercept);
        });
    });

    describe('#local-listeners', function() {
        it('should store local message listeners', function() {
            registry.addLocalListener('topic1', 'partition1', listener);
            var str = utils.getTopicString('topic1', 'partition1');
            expect(registry.reactor.listeners(str)).to.have.length(1);
            expect(registry.reactor.listeners(str)[0]).to.equal(listener);
        });
    });

    describe('#register', function() {
        it('should register a member for a topic and partition', function() {
            registry.registerMemberForTopic('topic2', 'partition2', me);
            var key = utils.getKey(me);
            var str = utils.getTopicString('topic2', 'partition2');

            expect(registry.map).to.have.property(key);
            expect(registry.map[key]).to.have.property('topic2');
            expect(registry.map[key]['topic2']).to.have.length(1);

            var list = registry.getRegisteredMembers('topic2');
            expect(list).to.have.length(1);
            expect(list[0]['topic']).to.equal('topic2');
            expect(list[0]['partition']).to.equal('partition2');
            expect(list[0]['member']).to.equal(me);

            /*
            registry.removeRegistrations(list[0]);
            expect(registry.map[key]['topic2']).to.have.length(0);
            */
        });
    });
});
