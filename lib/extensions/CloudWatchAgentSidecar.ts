import { MULTILINE_LOG_PATTERN } from '@constants';
import { createResourceName } from '@utils/common';
import {
  aws_ecs as ecs,
  aws_iam as iam,
  aws_logs as logs,
  aws_ssm as ssm,
  RemovalPolicy,
  Stack
} from 'aws-cdk-lib';

const CLOUDWATCH_AGENT_IMAGE =
  'public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest';

const CLOUDWATCH_AGENT_CONFIG = {
  logs: {
    metrics_collected: { emf: {} }
  },
  metrics: {
    metrics_collected: { statsd: {} }
  }
};

class CloudWatchAgentSidecar implements ecs.ITaskDefinitionExtension {
  private readonly id: string = 'CWAgentSidecar';

  constructor(id?: string) {
    this.id = id ?? this.id;
  }

  extend(taskDefinition: ecs.TaskDefinition) {
    const stack = Stack.of(taskDefinition);
    const executionRole = taskDefinition.obtainExecutionRole();

    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess')
    );
    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );
    taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );

    const image = ecs.ContainerImage.fromRegistry(CLOUDWATCH_AGENT_IMAGE);

    const logging = new ecs.AwsLogDriver({
      streamPrefix: 'cwagent',
      multilinePattern: MULTILINE_LOG_PATTERN,
      logGroup: new logs.LogGroup(stack, `${this.id}Logs`, {
        logGroupName: `/aws/ecs/${stack.stackName}/${this.id}`,
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: RemovalPolicy.DESTROY
      })
    });

    const configParam = new ssm.StringParameter(stack, `${this.id}Config`, {
      tier: ssm.ParameterTier.STANDARD,
      dataType: ssm.ParameterDataType.TEXT,
      stringValue: JSON.stringify(CLOUDWATCH_AGENT_CONFIG),
      parameterName: `/${stack.stackName}/cwagentconfig`,
      description: 'CloudWatch agent configuration file'
    });

    const sidecar = taskDefinition.addContainer(this.id, {
      containerName: createResourceName(stack, this.id),
      image,
      logging,
      cpu: 256,
      memoryLimitMiB: 256,
      memoryReservationMiB: 50,
      user: '0:1338' // Ensure that CloudWatch Agent outbound traffic doesn't go through proxy
    });

    sidecar.addSecret(
      'CW_CONFIG_CONTENT',
      ecs.Secret.fromSsmParameter(configParam)
    );

    sidecar.addPortMappings({
      hostPort: 25888,
      containerPort: 25888,
      protocol: ecs.Protocol.TCP
    });

    sidecar.addUlimits({
      softLimit: 65536,
      hardLimit: 65536,
      name: ecs.UlimitName.NOFILE
    });
  }
}

export default CloudWatchAgentSidecar;
