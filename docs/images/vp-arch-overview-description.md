<img src="vp-arch-overview.png" alt="AWS architecture diagram" />

AWS architecture diagram showing a cloud-based application workflow. The diagram contains multiple AWS services connected by arrows indicating data flow:

At the top, an EventBridge Schedule triggers a ManageWarmPool Lambda function. The flow connects to Virtual Participant components and tables including a VirtualParticipant Table.

On the left side, a User connects to HTTP API endpoints that interface with API Handlers and Lambda functions for operations like AppSync mutations and UpdateVirtualParticipantState.

The center shows various AWS services including UpdateTaskState and EventBridge ECS Task Change components connected to the main workflow.

At the bottom, there's a yellow-highlighted Stage section containing additional AWS services including a Stage Table, Secrets Manager with private keys, and connections to KMS for encryption. This section also shows a RotateKeyPair Lambda function.

The diagram uses standard AWS service icons in orange, purple, blue, and red colors, with connecting lines and arrows showing the relationships and data flow between components. Service names and brief descriptions are labeled next to each icon.
