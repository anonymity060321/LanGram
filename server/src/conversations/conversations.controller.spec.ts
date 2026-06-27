import { REALTIME_EVENTS } from '../realtime/realtime.events';
import { RealtimeSessionService } from '../realtime/realtime-session.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

describe('ConversationsController', () => {
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
});


