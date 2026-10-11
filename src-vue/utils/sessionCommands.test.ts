import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { setActivePinia, createPinia } from 'pinia';
import { useConferenceStore } from '@/stores/conferenceStore';
import { useLocalStore } from '@/stores/localStore';
import { useSessionFeaturesStore } from '@/stores/sessionFeaturesStore';
import { encodeNotesForWire } from './notesSync';
import { handleSessionCommand } from './sessionCommands';
import { getMediaEngineInstance } from '@/services/mediaEngineSingleton';

vi.mock('@/utils/uiSounds', () => ({
  playUiSound: vi.fn(),
}));

describe('handleSessionCommand', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('updates position and session features', () => {
    const conference = useConferenceStore();
    const features = useSessionFeaturesStore();
    conference.addUser('u1');
    handleSessionCommand('pos', { value: JSON.stringify({ id: 'u1', x: 1, y: 2 }) });
    expect(conference.users.u1.pos).toEqual({ x: 1, y: 2 });

    handleSessionCommand('name', { value: JSON.stringify({ id: 'u1', name: 'Renamed' }) });
    expect(conference.users.u1.user?._displayName).toBe('Renamed');

    handleSessionCommand('host', { value: JSON.stringify({ hostId: 'host1' }) });
    expect(features.hostId).toBe('host1');

    handleSessionCommand('react', { value: JSON.stringify({ id: 'u1', emoji: '👍' }) });
    expect(features.userReactions.u1?.emoji).toBe('👍');

    conference.addUser('u2');
    handleSessionCommand('hand', { value: JSON.stringify({ id: 'u2', raised: true }) });
    expect(conference.users.u2.properties.handRaised).toBe(true);
  });

  it('plays hand raise sound only once per raise', async () => {
    const { playUiSound } = await import('@/utils/uiSounds');
    const conference = useConferenceStore();
    conference.addUser('u2');
    const payload = { value: JSON.stringify({ id: 'u2', raised: true }) };
    handleSessionCommand('hand', payload);
    handleSessionCommand('hand', payload);
    handleSessionCommand('pos', { value: JSON.stringify({ id: 'u2', x: 3, y: 4 }) });
    handleSessionCommand('hand', payload);
    expect(playUiSound).toHaveBeenCalledTimes(1);
    expect(playUiSound).toHaveBeenCalledWith('handRaise');
  });

  it('applies room background commands', () => {
    const features = useSessionFeaturesStore();
    handleSessionCommand('room', {
      value: JSON.stringify({ gridBackgroundUrl: 'data:image/jpeg;base64,abc' }),
    });
    expect(features.gridBackgroundUrl).toBe('data:image/jpeg;base64,abc');

    handleSessionCommand('room', { value: JSON.stringify({ action: 'begin', total: 2 }) });
    handleSessionCommand('room', {
      value: JSON.stringify({ action: 'chunk', index: 0, data: 'data:image/jpeg;base64,' }),
    });
    handleSessionCommand('room', {
      value: JSON.stringify({ action: 'chunk', index: 1, data: 'abc' }),
    });
    expect(features.gridBackgroundUrl).toBe('data:image/jpeg;base64,abc');

    handleSessionCommand('room', { value: JSON.stringify({ action: 'clear' }) });
    expect(features.gridBackgroundUrl).toBe('');

    handleSessionCommand('room', { value: JSON.stringify({ gridBackgroundUrl: null }) });
    expect(features.gridBackgroundUrl).toBe('');

    handleSessionCommand('room', { value: 'not-json' });
    expect(features.gridBackgroundUrl).toBe('');

    handleSessionCommand('room', { value: JSON.stringify({ gridBackgroundUrl: 123 }) });
    expect(features.gridBackgroundUrl).toBe('');
  });

  it('handles lobby, poll, notes, and moderator actions', async () => {
    const { playUiSound } = await import('@/utils/uiSounds');
    const features = useSessionFeaturesStore();
    const conference = useConferenceStore();
    const local = useLocalStore();
    local.setMyID('me');
    features.hostId = 'other-host';

    // Non-host knock (no sound)
    features.isVerifiedHost = false;
    features.isVerifiedModerator = false;
    vi.mocked(playUiSound).mockClear();
    handleSessionCommand('lobby', {
      value: JSON.stringify({ enabled: true, action: 'wait', id: 'g1', name: 'Guest' }),
    });
    expect(features.lobbyEnabled).toBe(true);
    expect(features.lobbyWaiting[0]?.id).toBe('g1');
    expect(playUiSound).not.toHaveBeenCalled();

    // Host knock triggers lobbyKnock sound
    features.isVerifiedHost = true;
    vi.mocked(playUiSound).mockClear();
    handleSessionCommand('lobby', {
      value: JSON.stringify({ action: 'wait', id: 'g2', name: 'Guest 2' }),
    });
    expect(features.lobbyWaiting[1]?.id).toBe('g2');
    expect(playUiSound).toHaveBeenCalledWith('lobbyKnock');

    // Moderator knock triggers lobbyKnock sound
    features.isVerifiedHost = false;
    features.isVerifiedModerator = true;
    vi.mocked(playUiSound).mockClear();
    handleSessionCommand('lobby', {
      value: JSON.stringify({ action: 'wait', id: 'g3', name: 'Guest 3' }),
    });
    expect(features.lobbyWaiting[2]?.id).toBe('g3');
    expect(playUiSound).toHaveBeenCalledWith('lobbyKnock');
    features.isVerifiedModerator = false;

    features.localLobbyPending = true;
    handleSessionCommand('lobby', { value: JSON.stringify({ action: 'approve', id: 'me' }) });
    expect(features.lobbyApproved.me).toBe(true);
    expect(features.localLobbyPending).toBe(false);

    const poll = {
      id: 'p1',
      question: 'Q?',
      options: [
        { id: 'a', label: 'Yes', votes: 0 },
        { id: 'b', label: 'No', votes: 0 },
      ],
      open: true,
    };
    vi.mocked(playUiSound).mockClear();
    handleSessionCommand('poll', { value: JSON.stringify(poll) });
    expect(features.activePoll?.question).toBe('Q?');
    expect(features.hasUnreadPoll).toBe(true);
    expect(playUiSound).toHaveBeenCalledWith('chatMessage');

    features.panel = 'poll';
    features.pollSeenSeq = features.pollActivitySeq;
    vi.mocked(playUiSound).mockClear();
    handleSessionCommand('poll', {
      value: JSON.stringify({
        ...poll,
        options: [{ id: 'a', label: 'Yes', votes: 1, voters: ['other'] }],
      }),
    });
    expect(playUiSound).not.toHaveBeenCalled();
    expect(features.hasUnreadPoll).toBe(false);

    handleSessionCommand('poll', { value: 'not-json' });
    const bumps = features.pollActivitySeq;
    handleSessionCommand('poll', { value: JSON.stringify(poll) });
    expect(features.pollActivitySeq).toBe(bumps);

    handleSessionCommand('poll', { value: 'null' });
    expect(features.activePoll).toBeNull();

    handleSessionCommand('notes', { value: JSON.stringify({ text: 'hello' }) });
    expect(features.sharedNotes).toBe('hello');

    handleSessionCommand('notes', { value: JSON.stringify({ action: 'begin', total: 1 }) });
    handleSessionCommand('notes', {
      value: JSON.stringify({
        action: 'chunk',
        index: 0,
        data: encodeNotesForWire('# Markdown & <xml>'),
      }),
    });
    expect(features.sharedNotes).toBe('# Markdown & <xml>');

    handleSessionCommand('notes', { value: JSON.stringify({ action: 'clear' }) });
    expect(features.sharedNotes).toBe('');
    expect(features.hasUnreadNotes).toBe(true);

    const cmdSpy = vi.spyOn(getMediaEngineInstance(), 'sendCommand');
    handleSessionCommand('notes', { value: JSON.stringify({ action: 'yjs_request' }) });
    expect(cmdSpy).toHaveBeenCalledWith('notes', expect.stringContaining('yjs_begin'));

    const doc2 = new Y.Doc();
    doc2.getXmlFragment('default').insert(0, [new Y.XmlText('yjs test')]);
    const update = Y.encodeStateAsUpdate(doc2);
    const base64 = btoa(String.fromCharCode(...update));
    handleSessionCommand('notes', { value: JSON.stringify({ action: 'yjs_update', update: base64 }) });
    expect(features.ydoc.getXmlFragment('default').toString()).toContain('yjs test');

    const doc3 = new Y.Doc();
    doc3.getXmlFragment('default').insert(0, [new Y.XmlText('yjs chunk test')]);
    const update3 = Y.encodeStateAsUpdate(doc3);
    const base64_3 = btoa(String.fromCharCode(...update3));
    handleSessionCommand('notes', { value: JSON.stringify({ action: 'yjs_begin', total: 1 }) });
    handleSessionCommand('notes', { value: JSON.stringify({ action: 'yjs_chunk', index: 0, data: base64_3 }) });
    expect(features.ydoc.getXmlFragment('default').toString()).toContain('yjs chunk test');

    handleSessionCommand('wb', {
      value: JSON.stringify({
        action: 'stroke',
        stroke: { id: 's1', color: '#000', width: 2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      }),
    });
    expect(features.whiteboardStrokes).toHaveLength(1);
    expect(features.hasUnreadWhiteboard).toBe(true);

    conference.addUser('other');
    const leaveSpy = vi.spyOn(conference, 'leaveConference');
    handleSessionCommand('mod', { value: JSON.stringify({ action: 'kick', id: 'me' }) });
    expect(leaveSpy).toHaveBeenCalled();
  });

  it('mutes local participant when targeted', async () => {
    const local = useLocalStore();
    local.setMyID('me');
    const toggleSpy = vi.spyOn(local, 'toggleMute').mockResolvedValue(undefined);
    handleSessionCommand('mod', { value: JSON.stringify({ action: 'mute', id: 'me' }) });
    expect(toggleSpy).toHaveBeenCalled();
    local.mute = true;
    handleSessionCommand('mod', { value: JSON.stringify({ action: 'mute', id: 'me' }) });
    expect(toggleSpy).toHaveBeenCalledTimes(1);
  });

  it('syncs feature access flags', () => {
    const features = useSessionFeaturesStore();
    handleSessionCommand(
      'access',
      { value: JSON.stringify({ notes: true, whiteboard: true }) },
    );
    expect(features.roomDefaults.notes).toBe(true);
    expect(features.roomDefaults.whiteboard).toBe(true);
    handleSessionCommand('access', { value: JSON.stringify({ notes: false }) });
    expect(features.roomDefaults.notes).toBe(false);
    expect(features.roomDefaults.whiteboard).toBe(true);
    handleSessionCommand('access', { value: JSON.stringify({ whiteboard: false }) });
    expect(features.roomDefaults.whiteboard).toBe(false);
    handleSessionCommand(
      'access',
      { value: JSON.stringify({ userId: 'u2', grants: { poll: true } }) },
    );
    expect(features.grantsForUser('u2').poll).toBe(true);
    handleSessionCommand('access', { value: 'bad' });
  });

  it('ignores incomplete chat edit payloads', () => {
    const conference = useConferenceStore();
    conference.appendChatMessage({
      id: 'u1',
      text: 'old',
      nr: 1,
      messageId: 'm1',
      history: [],
    });
    handleSessionCommand('chat', { value: 'not-json' });
    handleSessionCommand('chat', { value: JSON.stringify({ action: 'noop' }) });
    handleSessionCommand('chat', { value: JSON.stringify({ action: 'edit', messageId: 'm1' }) });
    expect(conference.messages[0].text).toBe('old');
  });

  it('applies chat edit commands', () => {
    const conference = useConferenceStore();
    conference.appendChatMessage({
      id: 'u1',
      text: 'old',
      nr: 1,
      messageId: 'm1',
      history: [],
    });
    handleSessionCommand(
      'chat',
      {
        value: JSON.stringify({
          action: 'edit',
          messageId: 'm1',
          text: 'new',
          editedAt: 500,
          editorId: 'u1',
        }),
      },
    );
    expect(conference.messages[0].text).toBe('new');
    expect(conference.messages[0].editedAt).toBe(500);
  });

  it('applies chat edits by nr when message ids differ', () => {
    const conference = useConferenceStore();
    conference.appendChatMessage({
      id: 'u1',
      text: 'old',
      nr: 9,
      messageId: 'm-9-u1',
      history: [],
    });
    handleSessionCommand(
      'chat',
      {
        value: JSON.stringify({
          action: 'edit',
          messageId: 'sender-uuid',
          text: 'new',
          editedAt: 500,
          editorId: 'u1',
          nr: 9,
        }),
      },
    );
    expect(conference.messages[0].text).toBe('new');
  });

  it('rejects chat edits from non-authors', () => {
    const conference = useConferenceStore();
    conference.appendChatMessage({
      id: 'u1',
      text: 'old',
      nr: 1,
      messageId: 'm1',
      history: [],
    });
    handleSessionCommand(
      'chat',
      {
        value: JSON.stringify({
          action: 'edit',
          messageId: 'm1',
          text: 'hacked',
          editedAt: 500,
          editorId: 'host',
        }),
      },
    );
    expect(conference.messages[0].text).toBe('old');

    // Mismatched senderId vs editorId
    handleSessionCommand(
      'chat',
      {
        value: JSON.stringify({
          action: 'edit',
          messageId: 'm1',
          text: 'spoofed',
          editedAt: 500,
          editorId: 'u1',
        }),
      },
      'attacker',
    );
    expect(conference.messages[0].text).toBe('old');
  });

  it('handles chat delete command for moderators and authors, rejects for unauthorized users', () => {
    const conference = useConferenceStore();
    const features = useSessionFeaturesStore();
    features.setHost('host');

    conference.messages = [
      { id: 'user1', text: 'hello', nr: 1, messageId: 'm1' },
      { id: 'user2', text: 'world', nr: 2, messageId: 'm2' },
    ];

    // Unauthorized user trying to delete user1's message
    handleSessionCommand(
      'chat',
      { value: JSON.stringify({ action: 'delete', messageId: 'm1', senderId: 'user3' }) },
      'user3',
    );
    expect(conference.messages).toHaveLength(2);

    // Author deleting their own message
    handleSessionCommand(
      'chat',
      { value: JSON.stringify({ action: 'delete', messageId: 'm1', senderId: 'user1' }) },
      'user1',
    );
    expect(conference.messages[0].messageId).toBe('m2');

    // Moderator deleting user2's message
    handleSessionCommand(
      'chat',
      { value: JSON.stringify({ action: 'delete', messageId: 'm2', senderId: 'host' }) },
      'host',
    );
    expect(conference.messages).toHaveLength(0);

    // Delete by nr only using data.senderId without top-level senderId
    conference.messages = [{ id: 'user1', text: 'hello', nr: 5 }];
    handleSessionCommand('chat', {
      value: JSON.stringify({ action: 'delete', nr: 5, senderId: 'user1' }),
    });
    expect(conference.messages).toHaveLength(0);

    // Delete from unauthorized participant is rejected
    conference.messages = [{ id: 'user1', text: 'hello', nr: 6 }];
    handleSessionCommand(
      'chat',
      { value: JSON.stringify({ action: 'delete', nr: 6 }) },
      'user3',
    );
    expect(conference.messages).toHaveLength(1);
  });

  it('handles mod_change command for proposing, approving, and rejecting changes', () => {
    const features = useSessionFeaturesStore();
    const stroke = { id: 's1', color: '#000', width: 2, points: [{ x: 1, y: 1 }] };

    // Propose change with explicit timestamp and full details
    handleSessionCommand(
      'mod_change',
      {
        value: JSON.stringify({
          action: 'propose',
          id: 'mc-1',
          type: 'whiteboard',
          authorId: 'user1',
          authorName: 'User 1',
          payload: stroke,
          timestamp: 1234567,
        }),
      },
      'user1',
    );
    expect(features.pendingModerationChanges).toHaveLength(1);

    // Approve change
    handleSessionCommand(
      'mod_change',
      { value: JSON.stringify({ action: 'approve', id: 'mc-1' }) },
    );
    expect(features.pendingModerationChanges).toHaveLength(0);
    expect(features.whiteboardStrokes).toHaveLength(1);

    // Propose and reject change with omitted authorId and authorName
    handleSessionCommand(
      'mod_change',
      {
        value: JSON.stringify({
          action: 'propose',
          id: 'mc-2',
          type: 'notes',
          payload: 'draft notes',
        }),
      },
    );
    handleSessionCommand(
      'mod_change',
      { value: JSON.stringify({ action: 'reject', id: 'mc-2' }) },
    );
    expect(features.pendingModerationChanges).toHaveLength(0);

    // Unauthorized participant attempting to approve or reject is ignored
    handleSessionCommand(
      'mod_change',
      {
        value: JSON.stringify({
          action: 'propose',
          id: 'mc-unauth',
          type: 'notes',
          payload: 'pending notes',
        }),
      },
    );
    expect(features.pendingModerationChanges).toHaveLength(1);

    // Non-moderator tries to approve -> rejected/ignored
    handleSessionCommand(
      'mod_change',
      { value: JSON.stringify({ action: 'approve', id: 'mc-unauth' }) },
      'guest-attacker',
    );
    expect(features.pendingModerationChanges).toHaveLength(1);

    // Non-moderator tries to reject -> rejected/ignored
    handleSessionCommand(
      'mod_change',
      { value: JSON.stringify({ action: 'reject', id: 'mc-unauth' }) },
      'guest-attacker',
    );
    expect(features.pendingModerationChanges).toHaveLength(1);

    // Clean up
    features.rejectModerationChange('mc-unauth');

    // Invalid commands handled gracefully
    handleSessionCommand('mod_change', { value: 'not-json' });
    handleSessionCommand('mod_change', { value: JSON.stringify({}) });
  });

  it('handles whiteboard commands', () => {
    const features = useSessionFeaturesStore();
    const stroke = {
      id: 's1',
      color: '#000',
      width: 2,
      points: [{ x: 1, y: 2 }],
    };
    handleSessionCommand('wb', { value: JSON.stringify({ action: 'stroke', stroke }) });
    expect(features.whiteboardStrokes[0]?.id).toBe('s1');
    handleSessionCommand('wb', { value: JSON.stringify({ action: 'clear' }) });
    expect(features.whiteboardStrokes).toEqual([]);
    handleSessionCommand('wb', { value: 'not-json' });
    handleSessionCommand('wb', { value: JSON.stringify({ action: 'noop' }) });
  });

  it('handles stage promote, demote, layout, and settings commands', () => {
    const features = useSessionFeaturesStore();
    const local = useLocalStore();
    local.setMyID('guest');
    handleSessionCommand('stage', { value: JSON.stringify({ action: 'promote', id: 'guest' }) });
    expect(features.stageOccupantId).toBe('guest');
    expect(local.onStage).toBe(true);

    // Set occupant to someone else to test layout sync commands (bypassing loopback check)
    features.stageOccupantId = 'someone-else';
    handleSessionCommand(
      'stage',
      { value: JSON.stringify({ action: 'layout', layout: { scale: 1.2, expanded: true } }) },
    );
    expect(features.stageLayout.scale).toBe(1.2);
    expect(features.stageLayout.expanded).toBe(true);

    // Restore guest occupant
    features.stageOccupantId = 'guest';
    handleSessionCommand('stage', { value: JSON.stringify({ action: 'settings', stagePromotionEnabled: true }) });
    expect(features.stagePromotionEnabled).toBe(true);
    handleSessionCommand('stage', { value: JSON.stringify({ action: 'demote', id: 'guest' }) });
    expect(features.stageOccupantId).toBe('');
    expect(local.onStage).toBe(false);
    handleSessionCommand('stage', { value: 'bad' });
  });

  it('deduplicates stage commands with unique cmdId and trims processed cache', () => {
    const features = useSessionFeaturesStore();
    const local = useLocalStore();
    local.setMyID('guest');

    // First invite should succeed
    handleSessionCommand('stage', {
      value: JSON.stringify({ action: 'invite', id: 'guest', _cmdId: 'unique-1' }),
    });
    expect(features.stageInvitationPending).toBe(true);

    // Clear state
    features.stageInvitationPending = false;

    // Second invite with same cmdId should be ignored
    handleSessionCommand('stage', {
      value: JSON.stringify({ action: 'invite', id: 'guest', _cmdId: 'unique-1' }),
    });
    expect(features.stageInvitationPending).toBe(false);

    // Invite with new cmdId should succeed
    handleSessionCommand('stage', {
      value: JSON.stringify({ action: 'invite', id: 'guest', _cmdId: 'unique-2' }),
    });
    expect(features.stageInvitationPending).toBe(true);

    // Flood with 105 unique commands to cover cache pruning logic
    for (let i = 0; i < 105; i++) {
      handleSessionCommand('stage', {
        value: JSON.stringify({ action: 'invite', id: 'guest', _cmdId: `unique-flood-${i}` }),
      });
    }
  });

  it('covers defensive checks for empty first value in stage command cache pruning', () => {
    const local = useLocalStore();
    local.setMyID('guest');
    
    // Flood with 101 items first
    for (let i = 0; i < 101; i++) {
      handleSessionCommand('stage', {
        value: JSON.stringify({ action: 'settings', stagePromotionEnabled: true, _cmdId: `prune-flood-${i}` }),
      });
    }
    
    // Now mock Set.prototype.values to return undefined
    vi.spyOn(Set.prototype, 'values').mockImplementationOnce(function (this: any) {
      return {
        next: () => ({ done: true, value: undefined }),
        [Symbol.iterator]() { return this; }
      } as any;
    });
    
    handleSessionCommand('stage', {
      value: JSON.stringify({ action: 'settings', stagePromotionEnabled: true, _cmdId: 'prune-trigger' }),
    });
  });

  it('skips applying stage layout command when local user is the stage occupant', () => {
    const features = useSessionFeaturesStore();
    const local = useLocalStore();
    local.setMyID('occupant-id');
    features.stageOccupantId = 'occupant-id';
    
    features.stageLayout.scale = 1.0;
    
    handleSessionCommand('stage', {
      value: JSON.stringify({ action: 'layout', layout: { scale: 1.5, expanded: true } }),
    });
    
    expect(features.stageLayout.scale).toBe(1.0);
  });

  it('handles unknown command names', () => {
    handleSessionCommand('unknown', { value: '{}' });
  });

  it('mutes remote users in the conference store', () => {
    const conference = useConferenceStore();
    conference.addUser('peer');
    handleSessionCommand('mod', { value: JSON.stringify({ action: 'mute', id: 'peer' }) });
    expect(conference.users.peer.mute).toBe(true);
  });

  it('approves other users without clearing local lobby pending', () => {
    const features = useSessionFeaturesStore();
    const local = useLocalStore();
    local.setMyID('me');
    features.localLobbyPending = true;
    handleSessionCommand('lobby', { value: JSON.stringify({ action: 'approve', id: 'guest' }) });
    expect(features.lobbyApproved.guest).toBe(true);
    expect(features.localLobbyPending).toBe(true);
  });

  it('rejects other users without clearing local lobby pending', () => {
    const features = useSessionFeaturesStore();
    const local = useLocalStore();
    local.setMyID('me');
    features.localLobbyPending = true;
    features.addLobbyWaiter({ id: 'guest', name: 'Guest' });
    handleSessionCommand('lobby', { value: JSON.stringify({ action: 'reject', id: 'guest' }) });
    expect(features.lobbyWaiting).toHaveLength(0);
    expect(features.localLobbyPending).toBe(true);
    expect(features.lobbyRejected).toBe(false);
  });

  it('rejects self and clears local lobby pending', () => {
    const features = useSessionFeaturesStore();
    const local = useLocalStore();
    local.setMyID('me');
    features.localLobbyPending = true;
    features.addLobbyWaiter({ id: 'me', name: 'Me' });
    handleSessionCommand('lobby', { value: JSON.stringify({ action: 'reject', id: 'me' }) });
    expect(features.lobbyWaiting).toHaveLength(0);
    expect(features.localLobbyPending).toBe(false);
    expect(features.lobbyRejected).toBe(true);
  });

  it('ignores host commands while a join is claiming host', () => {
    const features = useSessionFeaturesStore();
    features.resetHostForJoin();
    handleSessionCommand('host', { value: JSON.stringify({ hostId: 'stale' }) });
    expect(features.hostId).toBe('');
  });

  it('ignores host commands when meetingExists is true', () => {
    const features = useSessionFeaturesStore();
    features.meetingExists = true;
    features.hostId = 'db-host';
    handleSessionCommand('host', { value: JSON.stringify({ hostId: 'other-host' }) });
    expect(features.hostId).toBe('db-host');
  });

  it('ignores partial command payloads', () => {
    const features = useSessionFeaturesStore();
    features.setHost('existing');
    handleSessionCommand('host', { value: JSON.stringify({ hostId: 'other' }) });
    expect(features.hostId).toBe('existing');

    handleSessionCommand('host', { value: 'bad' });
    handleSessionCommand('host', { value: '{}' });
    expect(features.hostId).toBe('existing');

    handleSessionCommand('lobby', { value: 'bad' });
    handleSessionCommand('lobby', { value: JSON.stringify({ action: 'wait' }) });
    handleSessionCommand('react', { value: JSON.stringify({ emoji: '👍' }) });
    handleSessionCommand('hand', { value: JSON.stringify({ id: 'u1' }) });
    handleSessionCommand('hand', { value: JSON.stringify({ raised: true }) });
    handleSessionCommand('pos', { value: JSON.stringify({ id: 'u1' }) });
    handleSessionCommand('poll', { value: 'null' });
    handleSessionCommand('notes', { value: JSON.stringify({}) });

    const conference = useConferenceStore();
    conference.addUser('u1');
    const leaveSpy = vi.spyOn(conference, 'leaveConference');
    handleSessionCommand('mod', { value: JSON.stringify({ action: 'kick', id: 'other' }) });
    expect(leaveSpy).not.toHaveBeenCalled();
  });

  it('ignores invalid payloads', () => {
    const conference = useConferenceStore();
    const features = useSessionFeaturesStore();
    conference.addUser('u1');
    const before = { ...conference.users.u1.pos };
    handleSessionCommand('pos', { value: 'not-json' });
    expect(conference.users.u1.pos).toEqual(before);
    features.sharedNotes = 'unchanged';
    handleSessionCommand('notes', { value: 'not-json' });
    expect(features.sharedNotes).toBe('unchanged');
  });

  it('ignores name commands with blank or missing names', () => {
    const conference = useConferenceStore();
    conference.addUser('u1', { _displayName: 'Original' });
    handleSessionCommand('name', { value: JSON.stringify({ id: 'u1', name: '   ' }) });
    handleSessionCommand('name', { value: JSON.stringify({ id: 'u1' }) });
    expect(conference.users.u1.user?._displayName).toBe('Original');
  });

  it('processes config commands to toggle features in real time', () => {
    const features = useSessionFeaturesStore();
    features.allowParticipantRecording = false;
    features.lobbyEnabled = false;
    features.stagePromotionEnabled = false;

    handleSessionCommand('config', {
      value: JSON.stringify({
        allowParticipantRecording: true,
        lobbyEnabled: true,
        stagePromotionEnabled: true,
      })
    });
    expect(features.allowParticipantRecording).toBe(true);
    expect(features.lobbyEnabled).toBe(true);
    expect(features.stagePromotionEnabled).toBe(true);

    handleSessionCommand('config', {
      value: JSON.stringify({
        lobbyEnabled: false,
      })
    });
    expect(features.allowParticipantRecording).toBe(true);
    expect(features.lobbyEnabled).toBe(false);
    expect(features.stagePromotionEnabled).toBe(true);

    handleSessionCommand('config', {
      value: JSON.stringify({
        allowParticipantRecording: false,
      })
    });
    expect(features.allowParticipantRecording).toBe(false);
    expect(features.lobbyEnabled).toBe(false);
    expect(features.stagePromotionEnabled).toBe(true);

    handleSessionCommand('config', { value: 'not-json' });
    expect(features.allowParticipantRecording).toBe(false);
  });

  it('prevents non-moderators from starting polls or clearing whiteboard', () => {
    const features = useSessionFeaturesStore();
    features.activePoll = undefined;
    features.setHost('host1');
    handleSessionCommand('poll', { value: JSON.stringify({ id: 'poll-1', question: 'q', options: ['a'] }) }, 'guest1');
    expect(features.activePoll).toBeUndefined();

    features.whiteboardStrokes = [{ x: 1, y: 1, isStart: true, color: '#000', size: 1 }];
    handleSessionCommand('wb', { value: JSON.stringify({ action: 'clear' }) }, 'guest1');
    expect(features.whiteboardStrokes.length).toBe(1);
  });

  it('handles poll_req create, approve, reject, and cancel actions', () => {
    const features = useSessionFeaturesStore();
    features.isVerifiedModerator = true;
    features.panel = '';

    const req = {
      id: 'pr-test-1',
      question: 'Next agenda?',
      options: ['Design', 'Engineering'],
      requesterId: 'user-1',
      requesterName: 'Alice',
      createdAt: 1000,
    };

    // create action
    handleSessionCommand('poll_req', {
      value: JSON.stringify({ action: 'create', request: req }),
    });
    expect(features.pendingPollRequests).toHaveLength(1);
    expect(features.pendingPollRequests[0].id).toBe('pr-test-1');
    expect(features.hasUnreadPoll).toBe(true);

    // approve action removes request
    handleSessionCommand('poll_req', {
      value: JSON.stringify({ action: 'approve', requestId: 'pr-test-1' }),
    });
    expect(features.pendingPollRequests).toHaveLength(0);

    // reject action removes request and sets notice if it was local user's request
    features.addPollRequest(req);
    features.myPendingPollRequestId = 'pr-test-1';
    handleSessionCommand('poll_req', {
      value: JSON.stringify({ action: 'reject', requestId: 'pr-test-1' }),
    });
    expect(features.pendingPollRequests).toHaveLength(0);
    expect(features.pollRequestNotice).toContain('declined by a moderator');

    // cancel action removes request
    features.addPollRequest(req);
    handleSessionCommand('poll_req', {
      value: JSON.stringify({ action: 'cancel', requestId: 'pr-test-1' }),
    });
    expect(features.pendingPollRequests).toHaveLength(0);

    // reject action when myPendingPollRequestId differs
    features.addPollRequest(req);
    features.myPendingPollRequestId = 'other-req';
    features.pollRequestNotice = '';
    handleSessionCommand('poll_req', {
      value: JSON.stringify({ action: 'reject', requestId: 'pr-test-1' }),
    });
    expect(features.pollRequestNotice).toBe('');

    // create action when local user is attendee (not mod/host)
    features.isVerifiedModerator = false;
    features.isVerifiedHost = false;
    features.pollActivitySeq = 0;
    features.pollSeenSeq = 0;
    handleSessionCommand('poll_req', {
      value: JSON.stringify({ action: 'create', request: req }),
    });
    expect(features.hasUnreadPoll).toBe(false);

    // create action when moderator has panel open
    features.isVerifiedModerator = true;
    features.panel = 'poll';
    handleSessionCommand('poll_req', {
      value: JSON.stringify({ action: 'create', request: { ...req, id: 'pr-2' } }),
    });

    // invalid payloads and no-op actions
    handleSessionCommand('poll_req', { value: 'not-json' });
    handleSessionCommand('poll_req', { value: JSON.stringify({}) });
    handleSessionCommand('poll_req', { value: JSON.stringify({ action: 'create' }) });
    handleSessionCommand('poll_req', { value: JSON.stringify({ action: 'approve' }) });
    handleSessionCommand('poll_req', { value: JSON.stringify({ action: 'reject' }) });
    handleSessionCommand('poll_req', { value: JSON.stringify({ action: 'cancel' }) });
    handleSessionCommand('poll_req', { value: JSON.stringify({ action: 'other' }) });
  });
});
