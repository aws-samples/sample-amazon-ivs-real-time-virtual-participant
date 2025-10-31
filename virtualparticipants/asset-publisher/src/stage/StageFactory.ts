import { jwtDecode } from 'jwt-decode';

import SEI from './SEI';
import Stage from './Stage';

class StageFactory {
  private static readonly stages = new Map<string, Stage>();

  static active = false;

  static create(token: string, socket: WebSocket | null) {
    const participantId = jwtDecode(token).jti!;
    let stage = StageFactory.stages.get(participantId);

    if (!stage) {
      stage = new Stage(token, socket);
      StageFactory.stages.set(participantId, stage);

      // Attach the stages to the window for debugging purposes
      Object.assign(window, { stages: StageFactory.stages });
    }

    StageFactory.active = true;

    return stage;
  }

  static get localPublishers() {
    const publishers: string[] = [];

    StageFactory.stages.forEach((stage, participantId) => {
      if (stage.publishing) {
        publishers.push(participantId);
      }
    });

    return publishers;
  }

  private static destroyStage(stage: Stage) {
    stage.leave();
    stage.removeAllListeners();
    StageFactory.stages.delete(stage.participantId);

    if (!StageFactory.stages.size) {
      delete (window as any).stages; // eslint-disable-line @typescript-eslint/no-explicit-any
      SEI.resetVisited();
    }
  }

  static destroyStages() {
    StageFactory.stages.forEach(StageFactory.destroyStage);
    StageFactory.active = false;
  }

  static leaveStages() {
    StageFactory.stages.forEach((stage) => stage.leave());
  }
}

export default StageFactory;
