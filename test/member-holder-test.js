var chai = require('chai');
var assert = chai.assert;
var expect = chai.expect;
var utils = require('../bigio/util/utils');
var holder = require('../bigio/member/member-holder');
var me_member = require('../bigio/member/me-member');
var MemberStatus = require('../bigio/member/member-status');

describe('member-holder', function() {
    it('should handle member status changes', function() {
        me = new me_member('127.0.0.1', 9999, 9998, true);
        key = utils.getKey({ member: me });

        expect(me.status).to.equal(MemberStatus.Unknown);
        holder.updateMemberStatus(me);

        expect(holder.members).to.have.property(key);
        expect(holder.deadMembers).to.have.property(key);
        expect(holder.activeMembers).to.not.have.property(key);

        me.status = MemberStatus.Alive;
        holder.updateMemberStatus(me);

        expect(holder.members).to.have.property(key);
        expect(holder.deadMembers).to.not.have.property(key);
        expect(holder.activeMembers).to.have.property(key);

        me.status = MemberStatus.Left;
        holder.updateMemberStatus(me);

        expect(holder.members).to.have.property(key);
        expect(holder.deadMembers).to.have.property(key);
        expect(holder.activeMembers).to.not.have.property(key);

        me.status = MemberStatus.Failed;
        holder.updateMemberStatus(me);

        expect(holder.members).to.have.property(key);
        expect(holder.deadMembers).to.have.property(key);
        expect(holder.activeMembers).to.not.have.property(key);
    });
});
