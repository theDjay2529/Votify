import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { supabase } from './supabase-config.js';

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;
const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

export function isListenTogetherConfigured() {
  return Boolean(LIVEKIT_URL);
}

export class ListenTogetherConnection {
  constructor({
    roomCode,
    participantId,
    displayName,
    isHost,
    audioContainer,
    onStatus,
    onParticipantCount,
    onAudioTrack,
    onQuality,
  }) {
    this.roomCode = roomCode;
    this.participantId = participantId;
    this.displayName = displayName;
    this.isHost = isHost;
    this.audioContainer = audioContainer;
    this.onStatus = onStatus || (() => {});
    this.onParticipantCount = onParticipantCount || (() => {});
    this.onAudioTrack = onAudioTrack || (() => {});
    this.onQuality = onQuality || (() => {});
    this.room = null;
    this.displayStream = null;
    this.publishedAudio = null;
  }

  async connect() {
    if (!LIVEKIT_URL) {
      throw new Error('Missing VITE_LIVEKIT_URL. Add your LiveKit Cloud WebSocket URL to .env.');
    }

    this.onStatus('connecting');
    const { token } = await this.fetchToken();
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    this.bindRoomEvents();
    await this.room.connect(LIVEKIT_URL, token);
    this.updateParticipantCount();
    this.onStatus('connected');
    return this.room;
  }

  async fetchToken() {
    if (FUNCTIONS_URL) {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${FUNCTIONS_URL.replace(/\/$/, '')}/livekit-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          roomCode: this.roomCode,
          participantId: this.participantId,
          displayName: this.displayName,
          isHost: this.isHost,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch local LiveKit token.');
      if (!data?.token) throw new Error(data?.error || 'LiveKit token response was empty.');
      return data;
    }

    const { data, error } = await supabase.functions.invoke('livekit-token', {
      body: {
        roomCode: this.roomCode,
        participantId: this.participantId,
        displayName: this.displayName,
        isHost: this.isHost,
      },
    });

    if (error) throw new Error(error.message || 'Failed to fetch LiveKit token.');
    if (!data?.token) throw new Error(data?.error || 'LiveKit token response was empty.');
    return data;
  }

  bindRoomEvents() {
    this.room
      .on(RoomEvent.Connected, () => {
        this.onStatus('connected');
        this.updateParticipantCount();
      })
      .on(RoomEvent.Disconnected, () => {
        this.onStatus('disconnected');
        this.updateParticipantCount();
      })
      .on(RoomEvent.Reconnecting, () => this.onStatus('reconnecting'))
      .on(RoomEvent.Reconnected, () => this.onStatus('connected'))
      .on(RoomEvent.ParticipantConnected, () => this.updateParticipantCount())
      .on(RoomEvent.ParticipantDisconnected, () => this.updateParticipantCount())
      .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (!participant || participant.isLocal) this.onQuality(formatQuality(quality));
      })
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.autoplay = true;
        element.controls = false;
        element.dataset.livekitAudio = 'true';
        this.audioContainer?.appendChild(element);
        this.onAudioTrack(element);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove());
      });
  }

  async publishTabAudio() {
    if (!this.room) await this.connect();

    this.onStatus('capturing');
    this.displayStream = await captureTabAudio();
    const [audioTrack] = this.displayStream.getAudioTracks();

    if (!audioTrack) {
      this.stopDisplayStream();
      throw new Error('No tab audio was shared. Choose a browser tab and enable audio sharing.');
    }

    this.displayStream.getVideoTracks().forEach((track) => track.stop());
    audioTrack.addEventListener('ended', () => {
      this.onStatus('audio-ended');
      this.publishedAudio = null;
    });

    this.publishedAudio = await this.room.localParticipant.publishTrack(audioTrack, {
      name: 'host-tab-audio',
      source: Track.Source.ScreenShareAudio,
    });
    this.onStatus('publishing');
    return this.publishedAudio;
  }

  async startAudio() {
    if (!this.room) return;
    await this.room.startAudio();
  }

  setVolume(value) {
    const volume = Number(value);
    this.audioContainer
      ?.querySelectorAll('audio[data-livekit-audio="true"]')
      .forEach((el) => { el.volume = volume; });
  }

  async resync() {
    await this.disconnect();
    await this.connect();
    await this.startAudio();
  }

  async disconnect() {
    this.stopDisplayStream();
    this.audioContainer
      ?.querySelectorAll('audio[data-livekit-audio="true"]')
      .forEach((el) => el.remove());
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
    this.publishedAudio = null;
  }

  stopDisplayStream() {
    if (!this.displayStream) return;
    this.displayStream.getTracks().forEach((track) => track.stop());
    this.displayStream = null;
  }

  updateParticipantCount() {
    if (!this.room) {
      this.onParticipantCount(0);
      return;
    }
    this.onParticipantCount(this.room.numParticipants || 1);
  }
}

async function captureTabAudio() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Your browser does not support tab audio sharing.');
  }

  try {
    return await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: false,
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError') throw err;
    return navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });
  }
}

function formatQuality(quality) {
  if (quality === ConnectionQuality.Excellent) return 'excellent';
  if (quality === ConnectionQuality.Good) return 'good';
  if (quality === ConnectionQuality.Poor) return 'poor';
  return 'unknown';
}
