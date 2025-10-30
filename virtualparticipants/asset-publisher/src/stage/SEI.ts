import {
  LocalStageStream,
  StageEvents,
  StreamType
} from 'amazon-ivs-web-broadcast';
import { nanoid } from 'nanoid';

import type Stage from './Stage';
import { SeiPayload, SeiReceivedCallback } from './types';

const {
  STAGE_PARTICIPANT_STREAMS_REMOVED,
  STAGE_PARTICIPANT_STREAMS_ADDED,
  ERROR
} = StageEvents;

class SEI {
  private readonly stage: Stage;

  private static readonly visited = new Set<string>();

  private readonly callbacks = new Set<SeiReceivedCallback>();

  private stream: LocalStageStream | null = null;

  constructor(stage: Stage) {
    this.stage = stage;

    this.stage.on(STAGE_PARTICIPANT_STREAMS_ADDED, (participant, streams) => {
      if (participant.isLocal) {
        const stream = streams.find((st) => st.streamType === StreamType.VIDEO);
        if (stream !== this.stream) this.stream = stream as LocalStageStream;
      }
    });

    this.stage.on(STAGE_PARTICIPANT_STREAMS_REMOVED, (participant, streams) => {
      if (participant.isLocal) {
        const stream = streams.find((st) => st.streamType === StreamType.VIDEO);
        if (stream === this.stream) this.stream = null;
      }
    });

    this.stage.on(ERROR, (error) => console.error(error));
  }

  registerSeiCallback(callback: SeiReceivedCallback) {
    this.callbacks.add(callback);
  }

  async sendSeiMessage(content: Record<string, unknown>, repeatCount?: number) {
    if (!this.stream) {
      throw new Error('[SEI] No video stream.');
    }

    const payload: SeiPayload = {
      id: nanoid(8),
      content: JSON.stringify(content)
    };
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    const buffer = encoded.buffer as ArrayBuffer;

    try {
      await this.stream.insertSeiMessage(buffer, { repeatCount });
      console.info('Sent SEI message to stream:', this.stream.id, content);
    } catch (e) {
      console.error('[SEI] Failed to send SEI message.', e);
      throw e;
    }

    return payload.id;
  }

  static resetVisited() {
    SEI.visited.clear();
  }
}

export default SEI;
