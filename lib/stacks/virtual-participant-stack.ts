import { INTERFACE_VPC_ENDPOINTS, MULTILINE_LOG_PATTERN } from '@constants';
import { LambdaFunction, LambdaTrigger, SecureBucket } from '@constructs';
import { CloudWatchAgentSidecar } from '@extensions';
import {
  ecsTagResourcesPolicy,
  ivsCreateResourcesPolicy,
  ivsGetResourcesPolicy,
  ivsPublicKeyPolicy,
  ivsTagResourcesPolicy,
  kmsGenerateDataKeyPairPolicy
} from '@policies';
import {
  capitalize,
  createDeterministicBucketName,
  createExportName,
  createResourceName
} from '@utils/common';
import { extractEcsEnvVars } from '@utils/ecs';
import { getLambdaEntryPath } from '@utils/lambda';
import {
  Aspects,
  aws_apigateway as apigw,
  aws_appsync as appsync,
  aws_cloudwatch_actions as cwActions,
  aws_dynamodb as ddb,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_kms as kms,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_secretsmanager as sm,
  aws_ssm as ssm,
  CfnOutput,
  Duration,
  Expiration,
  RemovalPolicy,
  Stack,
  StackProps,
  Tag
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import path from 'path';
import { AppEnv, Config } from 'typings/config.types';

interface VirtualParticipantStackProps extends StackProps {
  readonly appEnv: AppEnv;
  readonly config: Config;
  readonly virtualParticipant?: string;
}

class VirtualParticipantStack extends Stack {
  readonly appEnv: AppEnv;

  readonly config: Config;

  readonly virtualParticipant: string;

  readonly sg: ec2.SecurityGroup;

  readonly vpc: ec2.Vpc;

  readonly httpApi: apigw.RestApi;

  readonly gqlApi: appsync.GraphqlApi;

  readonly tasksIndexName = 'TasksIndex';

  readonly runningIndexName = 'RunningIndex';

  readonly assignedStageIdIndexName = 'AssignedStageIdIndex';

  readonly stateIndexName = 'Status';

  readonly alarmActions: cwActions.SnsAction[] = [];

  constructor(
    scope: Construct,
    id: string,
    props: VirtualParticipantStackProps
  ) {
    super(scope, id, props);

    const { config } = props;
    this.appEnv = props.appEnv;
    this.config = props.config;

    // Get VP type from props or context, default to asset-publisher
    this.virtualParticipant =
      props.virtualParticipant ??
      this.node.tryGetContext('virtualParticipant') ??
      'asset-publisher';

    // Validate VP type
    const validVpTypes = ['asset-publisher', 'gpt-realtime', 'nova-s2s'];
    if (!validVpTypes.includes(this.virtualParticipant)) {
      throw new Error(
        `Invalid virtual participant type: ${this.virtualParticipant}. ` +
          `Must be one of: ${validVpTypes.join(', ')}`
      );
    }

    console.info(`🎯 Building Virtual Participant: ${this.virtualParticipant}`);

    // ========== TELEMETRY ==========

    const logsBucket = new SecureBucket(this, 'LogsBucket', {
      bucketName: createDeterministicBucketName(this, 'logs'),
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER, // objectOwnership must be set to "ObjectWriter" when accessControl is "LogDeliveryWrite"
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      intelligentTieringConfigurations: [
        {
          name: 'archive',
          archiveAccessTierTime: Duration.days(90),
          deepArchiveAccessTierTime: Duration.days(180)
        }
      ]
    });

    // ========== VIDEO ASSETS BUCKET ==========

    const videoAssetsBucket = new SecureBucket(this, 'VideoAssetsBucket', {
      bucketName: createDeterministicBucketName(this, 'videoassets'),
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      intelligentTieringConfigurations: [
        {
          name: 'archive',
          archiveAccessTierTime: Duration.days(90),
          deepArchiveAccessTierTime: Duration.days(180)
        }
      ]
    });

    // ========== VPC ==========

    this.vpc = new ec2.Vpc(this, 'VPC', {
      vpcName: createResourceName(this, 'VPC'),
      maxAzs: config.vpc.maxAzs,
      natGateways: config.vpc.natGateways,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      restrictDefaultSecurityGroup: true,
      gatewayEndpoints: {
        s3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
        dynamo: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB }
      },
      subnetConfiguration: [
        {
          name: 'public',
          cidrMask: 28,
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          name: 'ingress',
          cidrMask: 24,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED
        },
        {
          name: 'egress',
          cidrMask: 24,
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
      ]
    });

    const { publicSubnets, isolatedSubnets, privateSubnets } = this.vpc;
    const subnets = [...publicSubnets, ...isolatedSubnets, ...privateSubnets];
    for (const subnet of subnets) {
      const subnetName = subnet.node.id.replace(/Subnet[0-9]$/, '');
      const subnetTagValue = `${this.vpc.node.id}-${subnetName}-${subnet.availabilityZone}`;
      Aspects.of(subnet).add(new Tag('Name', subnetTagValue));
    }

    const flsp = new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com');
    const flRole = new iam.Role(this, 'FlowLogsRole', { assumedBy: flsp });
    logsBucket.grantWrite(flRole, 'vpcFlowLogs/*');
    this.vpc.addFlowLog('vpcFlowLogs', {
      trafficType: ec2.FlowLogTrafficType.ALL,
      destination: ec2.FlowLogDestination.toS3(logsBucket, 'vpcFlowLogs/')
    });

    this.sg = new ec2.SecurityGroup(this, 'SG', {
      vpc: this.vpc,
      allowAllOutbound: true,
      securityGroupName: createResourceName(this, 'SG')
    });
    this.sg.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.HTTPS
    );
    if (config.enablePublicIP) {
      this.sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.HTTP);
    }

    for (const service of INTERFACE_VPC_ENDPOINTS) {
      const name = service.shortName.split(/-|\./).map(capitalize).join('');
      this.vpc.addInterfaceEndpoint(`${name}Vpce`, {
        service,
        open: true,
        securityGroups: [this.sg],
        privateDnsEnabled: true
      });
    }

    // ========== DB ==========

    const stagesTable = new ddb.TableV2(this, 'StagesTable', {
      tableName: createResourceName(this, 'Stages'),
      partitionKey: { name: 'id', type: ddb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl'
    });

    const virtualParticipantTable = new ddb.TableV2(
      this,
      'VirtualParticipantTable',
      {
        tableName: createResourceName(this, 'VirtualParticipants'),
        partitionKey: { name: 'id', type: ddb.AttributeType.STRING },
        removalPolicy: RemovalPolicy.DESTROY,
        timeToLiveAttribute: 'ttl',
        dynamoStream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
        globalSecondaryIndexes: [
          {
            indexName: this.assignedStageIdIndexName,
            partitionKey: {
              name: 'stageArn',
              type: ddb.AttributeType.STRING
            }
          },
          {
            indexName: this.stateIndexName,
            partitionKey: {
              name: 'status',
              type: ddb.AttributeType.STRING
            }
          },
          {
            indexName: this.tasksIndexName,
            partitionKey: {
              name: 'taskId',
              type: ddb.AttributeType.STRING
            }
          }
        ]
      }
    );

    // ========== GQL API ======

    this.gqlApi = new appsync.GraphqlApi(this, 'GqlApi', {
      name: createResourceName(this, 'GqlApi'),
      schema: appsync.SchemaFile.fromAsset(
        path.join(import.meta.dirname, '../../graphql/schema.graphql')
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: Expiration.after(Duration.days(365)),
            description:
              'Default AppSync API key used to authorize public consumers of the Virtual Participant GraphQL API'
          }
        },
        additionalAuthorizationModes: [
          { authorizationType: appsync.AuthorizationType.IAM }
        ]
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
        excludeVerboseContent: false,
        retention: logs.RetentionDays.ONE_MONTH
      }
    });

    const vpTableDataSource = this.gqlApi.addDynamoDbDataSource(
      'VPTableDataSource',
      virtualParticipantTable
    );

    vpTableDataSource.createResolver('UpdateVirtualParticipantStateResolver', {
      typeName: 'Mutation',
      fieldName: 'updateVirtualParticipantState',
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbPutItem(
        appsync.PrimaryKey.partition('id').is('input.id'),
        appsync.Values.projecting('input')
      ),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem()
    });

    vpTableDataSource.createResolver('GetAllVirtualParticipantsResolver', {
      typeName: 'Query',
      fieldName: 'getAllVirtualParticipants',
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbScanTable(),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultList()
    });

    vpTableDataSource.createResolver('GetVirtualParticipantResolver', {
      typeName: 'Query',
      fieldName: 'getVirtualParticipant',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "GetItem",
          "key": {
            "id": $util.dynamodb.toDynamoDBJson($ctx.args.id)
          }
        }
      `),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem()
    });

    // ========== TOKENS ==========

    const symmetricKey = new kms.Key(this, 'SymmetricEncryptionKey', {
      alias: createResourceName(this, 'SymmetricEncryptionKey'),
      enableKeyRotation: true,
      pendingWindow: Duration.days(7),
      keySpec: kms.KeySpec.SYMMETRIC_DEFAULT,
      keyUsage: kms.KeyUsage.ENCRYPT_DECRYPT,
      removalPolicy: RemovalPolicy.DESTROY,
      description:
        'Symmetric encryption key used to rotate the ECDSA public/private key-pair used to create and verify stage participant tokens.'
    });

    const privateKeySecret = new sm.Secret(this, 'PrivateKey', {
      secretName: createResourceName(this, 'PrivateKey'),
      removalPolicy: RemovalPolicy.DESTROY,
      description:
        'Stores the PEM-formatted private key used to create stage participant tokens.'
    });

    const publicKeyArnParam = new ssm.StringParameter(this, 'PublicKeyArn', {
      tier: ssm.ParameterTier.STANDARD,
      dataType: ssm.ParameterDataType.TEXT,
      parameterName: `/${this.stackName}/publicKeyArn`,
      stringValue: JSON.stringify({ arn: '' }),
      description:
        'Stores the ARN of the imported public key used to verify stage participant tokens.'
    });

    const rotateKeyPairLambda = new LambdaFunction(this, 'RotateKeyPair', {
      environment: {
        SYMMETRIC_KEY_ARN: symmetricKey.keyArn,
        PRIVATE_KEY_SECRET_ARN: privateKeySecret.secretArn,
        PUBLIC_KEY_PREFIX: createResourceName(this, 'PublicKey'),
        PUBLIC_KEY_ARN_PARAM_NAME: publicKeyArnParam.parameterName
      },
      initialPolicy: [
        ivsPublicKeyPolicy,
        ivsTagResourcesPolicy,
        kmsGenerateDataKeyPairPolicy
      ],
      entry: getLambdaEntryPath('rotateKeyPair'),
      functionName: createResourceName(this, 'RotateKeyPair'),
      description:
        'Rotates the public-private key pair used to create and verify participant tokens'
    });
    symmetricKey.grantDecrypt(rotateKeyPairLambda);
    privateKeySecret.grantRead(rotateKeyPairLambda);
    privateKeySecret.grantWrite(rotateKeyPairLambda);
    publicKeyArnParam.grantRead(rotateKeyPairLambda);
    publicKeyArnParam.grantWrite(rotateKeyPairLambda);

    const rotateKeyPairLambdaUrl = rotateKeyPairLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM
    });

    // Trigger the RotateKeyPair Lambda function to initialize the public/private key-pair
    new LambdaTrigger(this, 'RotateKeyPairLambdaTrigger', rotateKeyPairLambda);

    // ========== ECS ==========

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: createResourceName(this, 'Cluster'),
      enableFargateCapacityProviders: true,
      containerInsights: true,
      vpc: this.vpc
    });

    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: createResourceName(this, 'TaskExecutionRole'),
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        )
      ]
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: createResourceName(this, 'TaskRole'),
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ecs.amazonaws.com'),
        new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess')
      ],
      inlinePolicies: {
        AppSyncAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['appsync:GraphQL'],
              resources: [this.gqlApi.arn + '/*']
            })
          ]
        }),
        DynamoDbAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:Query',
                'dynamodb:UpdateItem',
                'dynamodb:Scan'
              ],
              resources: [
                virtualParticipantTable.tableArn,
                `${virtualParticipantTable.tableArn}/index/*`,
                stagesTable.tableArn,
                `${stagesTable.tableArn}/index/*`
              ]
            })
          ]
        })
      }
    });

    // Grant ECS task role READ access to the video assets bucket
    videoAssetsBucket.grantRead(taskRole);

    // Add Bedrock permissions for nova-s2s VP type
    if (this.virtualParticipant === 'nova-s2s') {
      taskRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:InvokeModel'
          ],
          resources: [
            `arn:aws:bedrock:*::foundation-model/amazon.nova-sonic-v1:0`
          ]
        })
      );
    }

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      taskRole,
      executionRole,
      cpu: 8192,
      memoryLimitMiB: 16384,
      pidMode: ecs.PidMode.TASK,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX
      }
    });

    const vpImage = ecs.ContainerImage.fromAsset(
      path.join(import.meta.dirname, '../../virtualparticipants'),
      {
        platform: ecrAssets.Platform.LINUX_AMD64,
        file: `${this.virtualParticipant}/Dockerfile`
      }
    );
    const vpLogging = new ecs.AwsLogDriver({
      streamPrefix: this.stackName,
      multilinePattern: MULTILINE_LOG_PATTERN,
      logRetention: logs.RetentionDays.ONE_YEAR
    });
    const vpLinuxParams = new ecs.LinuxParameters(this, 'LinuxParams', {
      initProcessEnabled: true
    });

    // Extract ECS_* prefixed environment variables from .env
    const ecsEnvVars = extractEcsEnvVars();

    // Validate required environment variables for specific VP types
    if (this.virtualParticipant === 'gpt-realtime') {
      if (
        !ecsEnvVars.ECS_OPENAI_API_KEY ||
        ecsEnvVars.ECS_OPENAI_API_KEY.trim() === ''
      ) {
        throw new Error(
          `ECS_OPENAI_API_KEY environment variable is required when deploying the gpt-realtime virtual participant. ` +
            `Please set this variable in your .env file.`
        );
      }
    }

    // Set up base container environment
    const containerEnvironment: Record<string, string> = {
      VP_TYPE: this.virtualParticipant,
      TINI_SUBREAPER: '1',
      AWS_EMF_ENVIRONMENT: 'ECS',
      AWS_EMF_NAMESPACE: this.stackName,
      AWS_EMF_AGENT_ENDPOINT: 'tcp://127.0.0.1:25888',
      VP_TABLE_NAME: virtualParticipantTable.tableName,
      STAGES_TABLE_NAME: stagesTable.tableName,
      TASKS_INDEX_NAME: this.tasksIndexName,
      STATE_INDEX_NAME: this.stateIndexName,
      GRAPHQL_API_URL: this.gqlApi.graphqlUrl,
      VIDEO_ASSETS_BUCKET_NAME: videoAssetsBucket.bucketName
    };

    // Add Nova S2S specific environment variables
    if (this.virtualParticipant === 'nova-s2s') {
      containerEnvironment.AWS_REGION = this.region;
      // Default to us-east-1 for Bedrock API calls as Nova Sonic is currently available there
      containerEnvironment.BEDROCK_REGION =
        ecsEnvVars.ECS_BEDROCK_REGION || 'us-east-1';
      containerEnvironment.NOVA_MODEL_ID =
        ecsEnvVars.ECS_NOVA_MODEL_ID || 'amazon.nova-sonic-v1:0';
      containerEnvironment.NOVA_VOICE_ID =
        ecsEnvVars.ECS_NOVA_VOICE_ID || 'matthew';
      containerEnvironment.NOVA_SYSTEM_PROMPT =
        ecsEnvVars.ECS_NOVA_SYSTEM_PROMPT ||
        'You are a helpful AI assistant in a video conversation. Be conversational, friendly, and engaging.';
    }

    if (this.virtualParticipant === 'gpt-realtime') {
      containerEnvironment.OPENAI_API_KEY = ecsEnvVars.ECS_OPENAI_API_KEY;
    }

    const vpContainer = taskDefinition.addContainer('VpContainer', {
      image: vpImage,
      logging: vpLogging,
      linuxParameters: vpLinuxParams,
      containerName: createResourceName(this, 'VpContainer'),
      portMappings: [{ hostPort: 80, containerPort: 80 }],
      environment: containerEnvironment,
      ulimits: [
        { name: ecs.UlimitName.NOFILE, hardLimit: 1048576, softLimit: 1048576 }
      ]
    });

    taskDefinition.addExtension(new CloudWatchAgentSidecar());

    new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 0,
      securityGroups: [this.sg],
      enableECSManagedTags: true,
      serviceName: createResourceName(this, 'Service')
    });

    // ========== HTTP API ==========

    this.httpApi = new apigw.RestApi(this, 'API', {
      restApiName: createResourceName(this, 'API'),
      endpointExportName: createExportName(this, 'apiUrl'),
      deployOptions: { stageName: this.appEnv },
      defaultCorsPreflightOptions: {
        allowMethods: ['GET', 'POST'],
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowHeaders: apigw.Cors.DEFAULT_HEADERS
      }
    });

    // Lambda function that creates a stage, writes it to dynamodb
    const createIvsStageLambda = new LambdaFunction(this, 'CreateIvsStage', {
      entry: getLambdaEntryPath('createIvsStage'),
      functionName: createResourceName(this, 'CreateIvsStage'),
      description: 'Creates a new IVS stage.',
      timeout: Duration.seconds(30),
      memorySize: 512,
      vpc: this.vpc,
      securityGroups: [this.sg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      initialPolicy: [
        ivsTagResourcesPolicy,
        ivsGetResourcesPolicy,
        ivsCreateResourcesPolicy
      ],
      environment: {
        IVS_REGION: this.region,
        IVS_ACCOUNT: this.account,
        STAGES_TABLE_NAME: stagesTable.tableName,
        PRIVATE_KEY_SECRET_ARN: privateKeySecret.secretArn,
        PUBLIC_KEY_ARN_PARAM_NAME: publicKeyArnParam.parameterName
      }
    });
    stagesTable.grantReadWriteData(createIvsStageLambda);
    privateKeySecret.grantRead(createIvsStageLambda);
    publicKeyArnParam.grantRead(createIvsStageLambda);

    // Conditionally expose via API Gateway or Lambda Function URL
    let createIvsStageLambdaUrl: lambda.FunctionUrl | undefined;
    if (config.enablePublicApi) {
      this.addAPILambdaProxy(createIvsStageLambda, {
        httpMethod: 'POST',
        resourcePath: ['stage', 'create']
      });
    } else {
      createIvsStageLambdaUrl = createIvsStageLambda.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.AWS_IAM
      });
    }

    // Lambda function that deletes a stage, removes it from dynamodb
    const deleteIvsStageLambda = new LambdaFunction(this, 'DeleteIvsStage', {
      entry: getLambdaEntryPath('deleteIvsStage'),
      functionName: createResourceName(this, 'DeleteIvsStage'),
      description: 'Deletes an IVS stage.',
      timeout: Duration.seconds(30),
      memorySize: 512,
      vpc: this.vpc,
      securityGroups: [this.sg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      initialPolicy: [
        ivsTagResourcesPolicy,
        ivsGetResourcesPolicy,
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ivs:DeleteStage'],
          resources: ['*']
        })
      ],
      environment: {
        IVS_REGION: this.region,
        IVS_ACCOUNT: this.account,
        STAGES_TABLE_NAME: stagesTable.tableName,
        PRIVATE_KEY_SECRET_ARN: privateKeySecret.secretArn,
        PUBLIC_KEY_ARN_PARAM_NAME: publicKeyArnParam.parameterName
      }
    });
    stagesTable.grantReadWriteData(deleteIvsStageLambda);
    privateKeySecret.grantRead(deleteIvsStageLambda);
    publicKeyArnParam.grantRead(deleteIvsStageLambda);

    // Conditionally expose via API Gateway or Lambda Function URL
    let deleteIvsStageLambdaUrl: lambda.FunctionUrl | undefined;
    if (config.enablePublicApi) {
      this.addAPILambdaProxy(deleteIvsStageLambda, {
        httpMethod: 'POST',
        resourcePath: ['stage', 'delete']
      });
    } else {
      deleteIvsStageLambdaUrl = deleteIvsStageLambda.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.AWS_IAM
      });
    }

    // Lambda function that creates a ParticipantToken for a stage
    const createIvsParticipantTokenLambda = new LambdaFunction(
      this,
      'CreateIvsParticipantToken',
      {
        entry: getLambdaEntryPath('joinIvsStage'),
        functionName: createResourceName(this, 'CreateIvsParticipantToken'),
        description: 'Creates a new participant token for an IVS stage.',
        timeout: Duration.seconds(30),
        memorySize: 512,
        vpc: this.vpc,
        securityGroups: [this.sg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        initialPolicy: [ivsGetResourcesPolicy],
        environment: {
          IVS_REGION: this.region,
          IVS_ACCOUNT: this.account,
          STAGES_TABLE_NAME: stagesTable.tableName,
          PRIVATE_KEY_SECRET_ARN: privateKeySecret.secretArn,
          PUBLIC_KEY_ARN_PARAM_NAME: publicKeyArnParam.parameterName
        }
      }
    );
    stagesTable.grantReadData(createIvsParticipantTokenLambda);
    privateKeySecret.grantRead(createIvsParticipantTokenLambda);
    publicKeyArnParam.grantRead(createIvsParticipantTokenLambda);
    this.addAPILambdaProxy(createIvsParticipantTokenLambda, {
      httpMethod: 'POST',
      resourcePath: ['stage', 'token']
    });

    // Grant ECS task role permission to invoke the createIvsParticipantToken lambda
    createIvsParticipantTokenLambda.grantInvoke(taskRole);
    // Add the lambda function ARN to the container environment
    vpContainer.addEnvironment(
      'CREATE_PARTICIPANT_TOKEN_LAMBDA_ARN',
      createIvsParticipantTokenLambda.functionArn
    );

    const inviteVpLambda = new LambdaFunction(this, 'InviteVp', {
      entry: getLambdaEntryPath('inviteVp'),
      functionName: createResourceName(this, 'InviteVp'),
      description: 'Invites a virtual participant to join the stage.',
      logRetention: logs.RetentionDays.ONE_MONTH,
      memorySize: 512,
      environment: {
        STAGES_TABLE_NAME: stagesTable.tableName,
        VP_TABLE_NAME: virtualParticipantTable.tableName,
        ASSIGNED_STAGE_ID_INDEX_NAME: this.assignedStageIdIndexName,
        STATE_INDEX_NAME: this.stateIndexName,
        PRIVATE_KEY_SECRET_ARN: privateKeySecret.secretArn,
        PUBLIC_KEY_ARN_PARAM_NAME: publicKeyArnParam.parameterName,
        VIDEO_ASSETS_BUCKET_NAME: videoAssetsBucket.bucketName
      }
    });
    stagesTable.grantReadData(inviteVpLambda);
    virtualParticipantTable.grantReadWriteData(inviteVpLambda);
    privateKeySecret.grantRead(inviteVpLambda);
    publicKeyArnParam.grantRead(inviteVpLambda);
    videoAssetsBucket.grantRead(inviteVpLambda);

    // Conditionally expose via API Gateway or Lambda Function URL
    let inviteVpLambdaUrl: lambda.FunctionUrl | undefined;
    if (config.enablePublicApi) {
      this.addAPILambdaProxy(inviteVpLambda, {
        httpMethod: 'POST',
        resourcePath: ['stage', 'invite']
      });
    } else {
      inviteVpLambdaUrl = inviteVpLambda.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.AWS_IAM
      });
    }

    const kickVpLambda = new LambdaFunction(this, 'KickVp', {
      entry: getLambdaEntryPath('kickVp'),
      functionName: createResourceName(this, 'KickVp'),
      description: 'Handles requests to kick a VP from the stage.',
      logRetention: logs.RetentionDays.ONE_MONTH,
      memorySize: 512,
      environment: {
        STAGES_TABLE_NAME: stagesTable.tableName,
        VP_TABLE_NAME: virtualParticipantTable.tableName,
        ASSIGNED_STAGE_ID_INDEX_NAME: this.assignedStageIdIndexName,
        PRIVATE_KEY_SECRET_ARN: privateKeySecret.secretArn,
        PUBLIC_KEY_ARN_PARAM_NAME: publicKeyArnParam.parameterName
      }
    });
    stagesTable.grantReadData(kickVpLambda);
    virtualParticipantTable.grantReadWriteData(kickVpLambda);
    privateKeySecret.grantRead(kickVpLambda);
    publicKeyArnParam.grantRead(kickVpLambda);

    // Conditionally expose via API Gateway or Lambda Function URL
    let kickVpLambdaUrl: lambda.FunctionUrl | undefined;
    if (config.enablePublicApi) {
      this.addAPILambdaProxy(kickVpLambda, {
        httpMethod: 'POST',
        resourcePath: ['stage', 'kick']
      });
    } else {
      kickVpLambdaUrl = kickVpLambda.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.AWS_IAM
      });
    }

    const stopVpTasksLambda = new LambdaFunction(this, 'StopVpTasks', {
      entry: getLambdaEntryPath('stopVpTasks'),
      functionName: createResourceName(this, 'StopVpTasks'),
      description: 'Stops all running Virtual Participant ECS tasks.',
      logRetention: logs.RetentionDays.ONE_MONTH,
      timeout: Duration.minutes(5),
      memorySize: 512,
      vpc: this.vpc,
      securityGroups: [this.sg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        VP_TABLE_NAME: virtualParticipantTable.tableName,
        STATE_INDEX_NAME: this.stateIndexName,
        CLUSTER_NAME: cluster.clusterName
      },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ecs:StopTask'],
          resources: ['*']
        })
      ]
    });
    virtualParticipantTable.grantReadWriteData(stopVpTasksLambda);

    const stopVpTasksLambdaUrl = stopVpTasksLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM
    });

    const listVpsLambda = new LambdaFunction(this, 'ListVps', {
      entry: getLambdaEntryPath('listVps'),
      functionName: createResourceName(this, 'ListVps'),
      description: 'Lists all virtual participants from the DynamoDB table.',
      logRetention: logs.RetentionDays.ONE_MONTH,
      memorySize: 512,
      environment: {
        VP_TABLE_NAME: virtualParticipantTable.tableName
      }
    });
    virtualParticipantTable.grantReadData(listVpsLambda);

    const listVpsLambdaUrl = listVpsLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM
    });

    const listStagesLambda = new LambdaFunction(this, 'ListStages', {
      entry: getLambdaEntryPath('listStages'),
      functionName: createResourceName(this, 'ListStages'),
      description: 'Lists all stages from the DynamoDB table.',
      logRetention: logs.RetentionDays.ONE_MONTH,
      memorySize: 512,
      environment: {
        STAGES_TABLE_NAME: stagesTable.tableName
      }
    });
    stagesTable.grantReadData(listStagesLambda);

    const listStagesLambdaUrl = listStagesLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM
    });

    // ========== VIRTUAL PARTICIPANT ==========

    const updateVpStateLambda = new LambdaFunction(this, 'UpdateVpState', {
      entry: getLambdaEntryPath('updateVpState'),
      functionName: createResourceName(this, 'UpdateVpState'),
      description:
        'Updates the VP state on AppSync and handles kicking VPs when the VP table is updated.',
      logRetention: logs.RetentionDays.THREE_MONTHS,
      timeout: Duration.minutes(5),
      memorySize: 512,
      vpc: this.vpc,
      securityGroups: [this.sg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        VP_TABLE_NAME: virtualParticipantTable.tableName,
        TASKS_INDEX_NAME: this.tasksIndexName,
        VP_CONTAINER_NAME: vpContainer.containerName,
        GRAPHQL_API_URL: this.gqlApi.graphqlUrl
      },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['appsync:GraphQL'],
          resources: [this.gqlApi.arn + '/*']
        })
      ]
    });

    // Grant permissions to the Lambda to read from the DynamoDB stream
    virtualParticipantTable.grantStreamRead(updateVpStateLambda);
    virtualParticipantTable.grantReadWriteData(updateVpStateLambda);
    this.gqlApi.grantMutation(updateVpStateLambda);

    // Create event source mapping to connect the DynamoDB stream to the Lambda
    new lambda.EventSourceMapping(this, 'UpdateVpStateEventSource', {
      target: updateVpStateLambda,
      eventSourceArn: virtualParticipantTable.tableStreamArn!,
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      retryAttempts: 3
    });

    // ========== WARM VP POOL MANAGEMENT ==========

    const manageWarmVpPoolLambda = new LambdaFunction(
      this,
      'ManageWarmVpPool',
      {
        entry: getLambdaEntryPath('manageWarmVpPool'),
        functionName: createResourceName(this, 'ManageWarmVpPool'),
        description:
          'Maintains a warm pool of Virtual Participants ready for invitation',
        logRetention: logs.RetentionDays.THREE_MONTHS,
        timeout: Duration.minutes(1),
        memorySize: 512,
        vpc: this.vpc,
        securityGroups: [this.sg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        environment: {
          VP_TABLE_NAME: virtualParticipantTable.tableName,
          STATE_INDEX_NAME: this.stateIndexName,
          VP_CONTAINER_NAME: vpContainer.containerName,
          CLUSTER_NAME: cluster.clusterName,
          TASK_DEFINITION_ARN: taskDefinition.taskDefinitionArn,
          SUBNET_IDS: this.vpc
            .selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
            .subnetIds.join(','),
          SECURITY_GROUP_IDS: this.sg.securityGroupId,
          ASSIGN_PUBLIC_IP: this.config.enablePublicIP ? 'true' : 'false',
          MAX_WARM_VPS: '4',
          MIN_WARM_VPS: '2'
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['ecs:RunTask'],
            resources: [taskDefinition.taskDefinitionArn]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['iam:PassRole'],
            resources: [taskRole.roleArn, executionRole.roleArn]
          }),
          ecsTagResourcesPolicy
        ]
      }
    );

    // Grant permissions for warm VP pool management
    virtualParticipantTable.grantReadWriteData(manageWarmVpPoolLambda);

    // Schedule the warm VP pool manager to run every 1 minute
    new events.Rule(this, 'ManageWarmVpPoolRule', {
      ruleName: createResourceName(this, 'ManageWarmVpPoolRule'),
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(manageWarmVpPoolLambda)]
    });

    // ========== EB RULES ==========

    const updateTaskLambda = new LambdaFunction(this, 'UpdateTaskFromEvents', {
      entry: getLambdaEntryPath('updateVpTask'),
      functionName: createResourceName(this, 'UpdateTaskFromEvents'),
      description:
        'Updates the VirtualParticipant table in task state changes from EventBridge events.',
      logRetention: logs.RetentionDays.THREE_MONTHS,
      timeout: Duration.minutes(1),
      memorySize: 512,
      vpc: this.vpc,
      securityGroups: [this.sg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      environment: {
        VP_TABLE_NAME: virtualParticipantTable.tableName,
        TASKS_INDEX_NAME: this.tasksIndexName,
        VP_CONTAINER_NAME: vpContainer.containerName
      }
    });
    virtualParticipantTable.grantReadWriteData(updateTaskLambda);
    updateTaskLambda.configureProvisionedConcurrency();

    new events.Rule(this, 'TaskStateChangeRule', {
      ruleName: createResourceName(this, 'TaskStateChangeRule'),
      targets: [new targets.LambdaFunction(updateTaskLambda)],
      eventPattern: {
        region: [this.region],
        account: [this.account],
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: { clusterArn: [cluster.clusterArn] }
      }
    });

    // ========== OUTPUTS ==========

    new CfnOutput(this, 'GraphQLApiEndpoint', {
      value: this.gqlApi.graphqlUrl,
      exportName: createExportName(this, 'GraphQLApiEndpoint')
    });
    new CfnOutput(this, 'RotateKeyPairLambdaURL', {
      value: rotateKeyPairLambdaUrl.url,
      exportName: createExportName(this, 'RotateKeyPairLambdaURL')
    });
    new CfnOutput(this, 'VideoAssetsBucketName', {
      value: videoAssetsBucket.bucketName,
      exportName: createExportName(this, 'VideoAssetsBucketName')
    });

    // Output API Gateway URL when public API is enabled
    if (config.enablePublicApi) {
      new CfnOutput(this, 'PublicApiUrl', {
        value: this.httpApi.url,
        exportName: createExportName(this, 'PublicApiUrl'),
        description: 'Public API Gateway URL for Lambda functions'
      });
    }

    // Output Lambda Function URLs when public API is disabled
    if (!config.enablePublicApi) {
      if (createIvsStageLambdaUrl) {
        new CfnOutput(this, 'CreateIvsStageLambdaURL', {
          value: createIvsStageLambdaUrl.url,
          exportName: createExportName(this, 'CreateIvsStageLambdaURL')
        });
      }

      if (deleteIvsStageLambdaUrl) {
        new CfnOutput(this, 'DeleteIvsStageLambdaURL', {
          value: deleteIvsStageLambdaUrl.url,
          exportName: createExportName(this, 'DeleteIvsStageLambdaURL')
        });
      }

      if (inviteVpLambdaUrl) {
        new CfnOutput(this, 'InviteVpLambdaURL', {
          value: inviteVpLambdaUrl.url,
          exportName: createExportName(this, 'InviteVpLambdaURL')
        });
      }

      if (kickVpLambdaUrl) {
        new CfnOutput(this, 'KickVpLambdaURL', {
          value: kickVpLambdaUrl.url,
          exportName: createExportName(this, 'KickVpLambdaURL')
        });
      }
    }

    new CfnOutput(this, 'StopVpTasksLambdaURL', {
      value: stopVpTasksLambdaUrl.url,
      exportName: createExportName(this, 'StopVpTasksLambdaURL')
    });
    new CfnOutput(this, 'ListVpsLambdaURL', {
      value: listVpsLambdaUrl.url,
      exportName: createExportName(this, 'ListVpsLambdaURL')
    });
    new CfnOutput(this, 'ListStagesLambdaURL', {
      value: listStagesLambdaUrl.url,
      exportName: createExportName(this, 'ListStagesLambdaURL')
    });
  }

  private addAPILambdaProxy(
    lambdaFunction: lambda.Function | lambda.Alias,
    options: {
      resourcePath?: string[];
      httpMethod?: string;
      rootResource?: apigw.Resource;
    }
  ) {
    const {
      resourcePath = [],
      httpMethod = 'GET',
      rootResource = this.httpApi.root
    } = options ?? {};
    const resource = resourcePath.reduce<apigw.IResource>((res, pathPart) => {
      // Check if resource already exists, if so return it, otherwise create new one
      const existingResource = res.getResource(pathPart);

      return existingResource ?? res.addResource(pathPart);
    }, rootResource);
    const lambdaIntegration = new apigw.LambdaIntegration(lambdaFunction, {
      proxy: true,
      allowTestInvoke: false
    });

    return resource.addMethod(httpMethod, lambdaIntegration);
  }
}

export default VirtualParticipantStack;
