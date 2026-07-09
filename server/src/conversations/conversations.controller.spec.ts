import { REALTIME_EVENTS } from '../realtime/realtime.events';
import { RealtimeSessionService } from '../realtime/realtime-session.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

describe('ConversationsController', () => {
  it('emits group updated events only to active group members after group name changes', async () => {
    const ownerConversation = {
      id: 'group-conversation-id',
      type: 'GROUP',
      title: 'New Room',
      intro: 'Updated intro',
      avatarUrl: '/api/files/group-avatar-file/download',
      announcement: 'Updated announcement',
      peer: null,
      members: [
        { id: 'user-a', email: 'a@example.test', displayName: 'User A', avatarUrl: null, statusMessage: null },
        { id: 'user-b', email: 'b@example.test', displayName: 'User B', avatarUrl: null, statusMessage: null },
      ],
      memberCount: 2,
    };
    const memberConversation = { ...ownerConversation };
    const conversationsService = {
      updateGroupConversation: jest.fn().mockResolvedValue({
        conversationId: 'group-conversation-id',
        conversation: ownerConversation,
        recipientConversations: [
          { userId: 'user-a', conversation: ownerConversation },
          { userId: 'user-b', conversation: memberConversation },
        ],
      }),
    } as unknown as ConversationsService;
    const userASocket = { emit: jest.fn() };
    const userBSocket = { emit: jest.fn() };
    const nonMemberSocket = { emit: jest.fn() };
    const realtimeSessionService = {
      getSocket: jest.fn((userId: string) => {
        if (userId === 'user-a') return userASocket;
        if (userId === 'user-b') return userBSocket;
        if (userId === 'user-x') return nonMemberSocket;
        return null;
      }),
    } as unknown as RealtimeSessionService;
    const controller = new ConversationsController(conversationsService, realtimeSessionService);

    const result = await controller.updateGroupConversation(
      { user: { id: 'user-a' } } as never,
      'group-conversation-id',
      {
        name: ' New Room ',
        intro: ' Updated intro ',
        avatarUrl: ' /api/files/group-avatar-file/download ',
        announcement: ' Updated announcement ',
      },
    );

    expect(result).toBe(ownerConversation);
    expect(conversationsService.updateGroupConversation).toHaveBeenCalledWith(
      'user-a',
      'group-conversation-id',
      {
        name: ' New Room ',
        intro: ' Updated intro ',
        avatarUrl: ' /api/files/group-avatar-file/download ',
        announcement: ' Updated announcement ',
      },
    );
    expect(userASocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_UPDATED,
      expect.objectContaining({
        conversationId: 'group-conversation-id',
        reason: 'group_updated',
        conversation: ownerConversation,
      }),
    );
    expect(userBSocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_UPDATED,
      expect.objectContaining({
        conversationId: 'group-conversation-id',
        reason: 'group_updated',
        conversation: memberConversation,
      }),
    );
    expect(nonMemberSocket.emit).not.toHaveBeenCalled();
    const payload = userASocket.emit.mock.calls[0][1];
    expect(JSON.stringify(payload)).not.toContain('token');
    expect(JSON.stringify(payload)).not.toContain('plaintext');
    expect(JSON.stringify(payload)).not.toContain('ciphertext');
    expect(JSON.stringify(payload)).not.toContain('nonce');
    expect(payload.conversation.intro).toBe('Updated intro');
    expect(payload.conversation.avatarUrl).toBe('/api/files/group-avatar-file/download');
    expect(payload.conversation.announcement).toBe('Updated announcement');
  });
  it('emits group member updates only to conversation members after group nickname changes', async () => {
    const updatedConversation = {
      id: 'group-conversation-id',
      type: 'GROUP',
      title: 'Project Room',
      peer: null,
      members: [
        {
          id: 'user-a',
          email: 'a@example.test',
          displayName: 'User A',
          avatarUrl: null,
          statusMessage: null,
          groupNickname: 'Captain',
          isOnline: true,
          lastSeenAt: null,
        },
        {
          id: 'user-b',
          email: 'b@example.test',
          displayName: 'User B',
          avatarUrl: null,
          statusMessage: null,
          groupNickname: null,
          isOnline: true,
          lastSeenAt: null,
        },
      ],
      memberCount: 2,
    };
    const conversationsService = {
      updateGroupNickname: jest.fn().mockResolvedValue(updatedConversation),
    } as unknown as ConversationsService;
    const userASocket = { emit: jest.fn() };
    const userBSocket = { emit: jest.fn() };
    const nonMemberSocket = { emit: jest.fn() };
    const realtimeSessionService = {
      getSocket: jest.fn((userId: string) => {
        if (userId === 'user-a') return userASocket;
        if (userId === 'user-b') return userBSocket;
        if (userId === 'user-x') return nonMemberSocket;
        return null;
      }),
    } as unknown as RealtimeSessionService;
    const controller = new ConversationsController(conversationsService, realtimeSessionService);

    const result = await controller.updateGroupNickname(
      { user: { id: 'user-a' } } as never,
      'group-conversation-id',
      { groupNickname: 'Captain' },
    );

    expect(result).toBe(updatedConversation);
    expect(conversationsService.updateGroupNickname).toHaveBeenCalledWith(
      'user-a',
      'group-conversation-id',
      'Captain',
    );
    expect(userASocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED,
      expect.objectContaining({
        conversationId: 'group-conversation-id',
        reason: 'group_member_updated',
        member: expect.objectContaining({
          id: 'user-a',
          groupNickname: 'Captain',
        }),
      }),
    );
    expect(userBSocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED,
      expect.objectContaining({
        conversationId: 'group-conversation-id',
        reason: 'group_member_updated',
        member: expect.objectContaining({
          id: 'user-a',
          groupNickname: 'Captain',
        }),
      }),
    );
    expect(nonMemberSocket.emit).not.toHaveBeenCalled();

    const payload = userASocket.emit.mock.calls[0][1];
    expect(payload.member).not.toHaveProperty('groupRemark');
    expect(JSON.stringify(payload)).not.toContain('token');
    expect(JSON.stringify(payload)).not.toContain('password');
    expect(JSON.stringify(payload)).not.toContain('ciphertext');
  });
  it('emits group member left updates only to remaining active members after leaving', async () => {
    const leftAt = new Date('2026-06-27T08:00:00.000Z');
    const conversationsService = {
      leaveGroup: jest.fn().mockResolvedValue({
        conversationId: 'group-conversation-id',
        leftAt,
        member: {
          id: 'user-a',
          userId: 'user-a',
          email: 'a@example.test',
          displayName: 'User A',
          avatarUrl: null,
          groupNickname: 'Captain',
          groupRemark: 'Private Room',
          leftAt,
        },
        remainingMemberIds: ['user-b', 'user-c'],
      }),
    } as unknown as ConversationsService;
    const userBSocket = { emit: jest.fn() };
    const userCSocket = { emit: jest.fn() };
    const leavingSocket = { emit: jest.fn() };
    const nonMemberSocket = { emit: jest.fn() };
    const realtimeSessionService = {
      getSocket: jest.fn((userId: string) => {
        if (userId === 'user-a') return leavingSocket;
        if (userId === 'user-b') return userBSocket;
        if (userId === 'user-c') return userCSocket;
        if (userId === 'user-x') return nonMemberSocket;
        return null;
      }),
    } as unknown as RealtimeSessionService;
    const controller = new ConversationsController(conversationsService, realtimeSessionService);

    const result = await controller.leaveGroup(
      { user: { id: 'user-a' } } as never,
      'group-conversation-id',
    );

    expect(result).toEqual({ conversationId: 'group-conversation-id', leftAt });
    expect(conversationsService.leaveGroup).toHaveBeenCalledWith('user-a', 'group-conversation-id');
    expect(userBSocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED,
      expect.objectContaining({
        conversationId: 'group-conversation-id',
        reason: 'group_member_left',
        member: expect.objectContaining({ id: 'user-a', leftAt }),
      }),
    );
    expect(userCSocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED,
      expect.objectContaining({ reason: 'group_member_left' }),
    );
    expect(userBSocket.emit.mock.calls[0][1].member).not.toHaveProperty('groupRemark');
    expect(leavingSocket.emit).not.toHaveBeenCalled();
    expect(nonMemberSocket.emit).not.toHaveBeenCalled();
  });
  it('updates group remarks without emitting group member realtime events', async () => {
    const updatedConversation = {
      id: 'group-conversation-id',
      type: 'GROUP',
      title: 'Project Room',
      peer: null,
      members: [
        {
          id: 'user-a',
          email: 'a@example.test',
          displayName: 'User A',
          avatarUrl: null,
          groupNickname: null,
          groupRemark: 'Private Room',
          leftAt: null,
        },
        {
          id: 'user-b',
          email: 'b@example.test',
          displayName: 'User B',
          avatarUrl: null,
          groupNickname: null,
          groupRemark: null,
          leftAt: null,
        },
      ],
      memberCount: 2,
    };
    const conversationsService = {
      updateGroupRemark: jest.fn().mockResolvedValue(updatedConversation),
    } as unknown as ConversationsService;
    const realtimeSessionService = {
      getSocket: jest.fn(),
    } as unknown as RealtimeSessionService;
    const controller = new ConversationsController(conversationsService, realtimeSessionService);

    const result = await controller.updateGroupRemark(
      { user: { id: 'user-a' } } as never,
      'group-conversation-id',
      { groupRemark: 'Private Room' },
    );

    expect(result).toBe(updatedConversation);
    expect(conversationsService.updateGroupRemark).toHaveBeenCalledWith(
      'user-a',
      'group-conversation-id',
      'Private Room',
    );
    expect(realtimeSessionService.getSocket).not.toHaveBeenCalled();
  });
  it('emits added group conversation updates only to active members and newly added members', async () => {
    const operatorConversation = {
      id: 'group-conversation-id',
      type: 'GROUP',
      title: 'Project Room',
      peer: null,
      members: [
        { id: 'user-a', displayName: 'User A', email: null, groupRemark: 'Private A', leftAt: null },
        { id: 'user-b', displayName: 'User B', email: null, groupRemark: null, leftAt: null },
        { id: 'user-c', displayName: 'User C', email: null, groupRemark: null, leftAt: null },
      ],
      memberCount: 3,
    };
    const userBConversation = {
      ...operatorConversation,
      members: operatorConversation.members.map((member) => ({
        ...member,
        groupRemark: member.id === 'user-b' ? 'Private B' : null,
      })),
    };
    const userCConversation = {
      ...operatorConversation,
      members: operatorConversation.members.map((member) => ({
        ...member,
        groupRemark: null,
      })),
    };
    const conversationsService = {
      addGroupMembers: jest.fn().mockResolvedValue({
        conversationId: 'group-conversation-id',
        conversation: operatorConversation,
        recipientConversations: [
          { userId: 'user-a', conversation: operatorConversation },
          { userId: 'user-b', conversation: userBConversation },
          { userId: 'user-c', conversation: userCConversation },
        ],
      }),
    } as unknown as ConversationsService;
    const userASocket = { emit: jest.fn() };
    const userBSocket = { emit: jest.fn() };
    const userCSocket = { emit: jest.fn() };
    const nonMemberSocket = { emit: jest.fn() };
    const realtimeSessionService = {
      getSocket: jest.fn((userId: string) => {
        if (userId === 'user-a') return userASocket;
        if (userId === 'user-b') return userBSocket;
        if (userId === 'user-c') return userCSocket;
        if (userId === 'user-x') return nonMemberSocket;
        return null;
      }),
    } as unknown as RealtimeSessionService;
    const controller = new ConversationsController(conversationsService, realtimeSessionService);

    const result = await controller.addGroupMembers(
      { user: { id: 'user-a' } } as never,
      'group-conversation-id',
      { userIds: ['user-c'] },
    );

    expect(result).toBe(operatorConversation);
    expect(conversationsService.addGroupMembers).toHaveBeenCalledWith('user-a', 'group-conversation-id', ['user-c']);
    expect(userASocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED,
      expect.objectContaining({
        conversationId: 'group-conversation-id',
        reason: 'group_member_added',
        conversation: operatorConversation,
      }),
    );
    expect(userBSocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED,
      expect.objectContaining({ reason: 'group_member_added', conversation: userBConversation }),
    );
    expect(userCSocket.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED,
      expect.objectContaining({ reason: 'group_member_added', conversation: userCConversation }),
    );
    expect(nonMemberSocket.emit).not.toHaveBeenCalled();
    expect(userBSocket.emit.mock.calls[0][1].conversation.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'user-a', groupRemark: null }),
        expect.objectContaining({ id: 'user-b', groupRemark: 'Private B' }),
      ]),
    );
    expect(JSON.stringify(userCSocket.emit.mock.calls[0][1])).not.toContain('token');
    expect(JSON.stringify(userCSocket.emit.mock.calls[0][1])).not.toContain('ciphertext');
  });
  it('emits removed group member updates to remaining active members and the removed member', async () => {
    const removedAt = new Date('2026-06-30T08:00:00.000Z');
    const updatedConversation = {
      id: 'group-conversation-id',
      type: 'GROUP',
      title: 'Project Room',
      peer: null,
      members: [
        { id: 'user-a', displayName: 'User A', email: null, role: 'OWNER', leftAt: null },
        { id: 'user-c', displayName: 'User C', email: null, role: 'MEMBER', leftAt: null },
      ],
      memberCount: 2,
    };
    const conversationsService = {
      removeGroupMember: jest.fn().mockResolvedValue({
        conversationId: 'group-conversation-id',
        removedUserId: 'user-b',
        conversation: updatedConversation,
        member: {
          id: 'user-b',
          userId: 'user-b',
          email: 'b@example.test',
          displayName: 'User B',
          avatarUrl: null,
          groupNickname: null,
          groupRemark: 'Private B',
          role: 'MEMBER',
          leftAt: removedAt,
        },
        remainingMemberIds: ['user-a', 'user-c'],
      }),
    } as unknown as ConversationsService;
    const userASocket = { emit: jest.fn() };
    const userBSocket = { emit: jest.fn() };
    const userCSocket = { emit: jest.fn() };
    const nonMemberSocket = { emit: jest.fn() };
    const realtimeSessionService = {
      getSocket: jest.fn((userId: string) => {
        if (userId === 'user-a') return userASocket;
        if (userId === 'user-b') return userBSocket;
        if (userId === 'user-c') return userCSocket;
        if (userId === 'user-x') return nonMemberSocket;
        return null;
      }),
    } as unknown as RealtimeSessionService;
    const controller = new ConversationsController(conversationsService, realtimeSessionService);

    const result = await controller.removeGroupMember(
      { user: { id: 'user-a' } } as never,
      'group-conversation-id',
      'user-b',
    );

    expect(result).toBe(updatedConversation);
    expect(conversationsService.removeGroupMember).toHaveBeenCalledWith('user-a', 'group-conversation-id', 'user-b');
    for (const socket of [userASocket, userBSocket, userCSocket]) {
      expect(socket.emit).toHaveBeenCalledWith(
        REALTIME_EVENTS.CONVERSATION_MEMBER_UPDATED,
        expect.objectContaining({
          conversationId: 'group-conversation-id',
          reason: 'group_member_removed',
          removedUserId: 'user-b',
          member: expect.objectContaining({ id: 'user-b', role: 'MEMBER', leftAt: removedAt }),
        }),
      );
    }
    expect(nonMemberSocket.emit).not.toHaveBeenCalled();
    const payload = userASocket.emit.mock.calls[0][1];
    expect(payload.member).not.toHaveProperty('groupRemark');
    expect(JSON.stringify(payload)).not.toContain('token');
    expect(JSON.stringify(payload)).not.toContain('ciphertext');
  });
});
