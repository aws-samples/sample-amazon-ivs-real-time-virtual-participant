import {
  ContainerOverride,
  ECSClient,
  KeyValuePair,
  RunTaskCommand,
  RunTaskRequest,
  StopTaskCommand,
  Tag
} from '@aws-sdk/client-ecs';
import { RESOURCE_TAGS } from '@lambda/constants';

const ecsClient = new ECSClient();

async function runTask(
  input: Pick<
    RunTaskRequest,
    'cluster' | 'taskDefinition' | 'networkConfiguration'
  > & { environment?: Record<string, KeyValuePair[]> }
) {
  const { environment = {}, ...requestParams } = input;
  const tags = Object.entries(RESOURCE_TAGS).map<Tag>(([key, value]) => ({
    key,
    value
  }));

  const containerOverrides = Object.keys(environment).map<ContainerOverride>(
    (containerName) => ({
      name: containerName,
      environment: environment[containerName]
    })
  );

  const { tasks = [] } = await ecsClient.send(
    new RunTaskCommand({
      ...requestParams,
      tags,
      count: 1,
      launchType: 'FARGATE',
      enableECSManagedTags: true,
      propagateTags: 'TASK_DEFINITION',
      startedBy: process.env.AWS_LAMBDA_FUNCTION_NAME,
      overrides: { containerOverrides }
    })
  );

  return tasks[0];
}

async function stopTask(cluster: string, taskId: string) {
  const { task } = await ecsClient.send(
    new StopTaskCommand({
      cluster,
      task: taskId,
      reason: `User initiated via ${process.env.AWS_LAMBDA_FUNCTION_NAME}.`
    })
  );

  return task!;
}

export { runTask, stopTask };
