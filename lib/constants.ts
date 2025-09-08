import { aws_ec2 as ec2 } from 'aws-cdk-lib';

const IVPCE = ec2.InterfaceVpcEndpointAwsService;

const INTERFACE_VPC_ENDPOINTS = [
  IVPCE.SSM,
  IVPCE.ECS,
  IVPCE.ECR,
  IVPCE.ECS_AGENT,
  IVPCE.ECR_DOCKER,
  IVPCE.ECS_TELEMETRY,
  IVPCE.CLOUDWATCH_LOGS,
  IVPCE.SECRETS_MANAGER,
  IVPCE.LAMBDA
];

const MULTILINE_LOG_PATTERN =
  '^\\d{4}[-/]\\d{2}[-/]\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d{3})?Z?';

export { INTERFACE_VPC_ENDPOINTS, MULTILINE_LOG_PATTERN };
