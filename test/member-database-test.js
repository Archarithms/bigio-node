var chai = require('chai');
var assert = chai.assert;
var expect = chai.expect;
var utils = require('../bigio/utils');
var db = require('../bigio/member/member-database');
var me_member = require('../bigio/member/me');
var MemberStatus = require('../bigio/member/member-status');

function intercept() { }
function listener() { }

describe('listener-db', function() {
    describe('#listener-registration', function() {
        me = new me_member({ip: '127.0.0.1', gossipPort: 9999, dataPort: 9998, protocol: 'tcp'});
        db.initialize(me);
        key = utils.getKey({ member: me });

        describe('#interceptors', function() {
            it('should store interceptors', function() {
                db.addInterceptor('test', intercept);
                expect(db.interceptors).to.have.property('test');
                expect(db.interceptors['test']).to.have.length(1);
                expect(db.interceptors['test'][0]).to.equal(intercept);
            });
        });

        describe('#local-listeners', function() {
            it('should store local message listeners', function() {
                db.addLocalListener('topic1', 'partition1', listener);
                var str = utils.getTopicString('topic1', 'partition1');
                expect(db.reactor.listeners(str)).to.have.length(1);
                expect(db.reactor.listeners(str)[0]).to.equal(listener);
            });
        });

        describe('#register', function() {
            it('should register a member for a topic and partition', function() {
                db.registerMemberForTopic('topic2', 'partition2', me);
                var key = utils.getKey(me);
                var str = utils.getTopicString('topic2', 'partition2');

                expect(db.map).to.have.property(key);
                expect(db.map[key]).to.have.property('topic2');
                expect(db.map[key]['topic2']).to.have.length(1);

                var list = db.getRegisteredMembers('topic2');
                expect(list).to.have.length(1);
                expect(list[0]['topic']).to.equal('topic2');
                expect(list[0]['partition']).to.equal('partition2');
                expect(list[0]['member']).to.equal(me);

                /*
                db.removeRegistrations(list[0]);
                expect(db.map[key]['topic2']).to.have.length(0);
                */
            });
        });
    });
    describe('#member-holder', function() {
        it('should handle member status changes', function() {
            me = new me_member('127.0.0.1', 9999, 9998, true);
            key = utils.getKey({ member: me });

            expect(me.status).to.equal(MemberStatus.Unknown);
            db.updateMemberStatus(me);

            expect(db.members).to.have.property(key);
            expect(db.deadMembers).to.have.property(key);
            expect(db.activeMembers).to.not.have.property(key);

            me.status = MemberStatus.Alive;
            db.updateMemberStatus(me);

            expect(db.members).to.have.property(key);
            expect(db.deadMembers).to.not.have.property(key);
            expect(db.activeMembers).to.have.property(key);

            me.status = MemberStatus.Left;
            db.updateMemberStatus(me);

            expect(db.members).to.have.property(key);
            expect(db.deadMembers).to.have.property(key);
            expect(db.activeMembers).to.not.have.property(key);

            me.status = MemberStatus.Failed;
            db.updateMemberStatus(me);

            expect(db.members).to.have.property(key);
            expect(db.deadMembers).to.have.property(key);
            expect(db.activeMembers).to.not.have.property(key);
        });
    });
});
