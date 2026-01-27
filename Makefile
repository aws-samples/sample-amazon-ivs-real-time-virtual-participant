.PHONY: help app install bootstrap synth diff deploy output destroy clean guard-%
.DEFAULT_GOAL := help

# Configurable environment variables
#
# - VP: virtual participant type to deploy
#       options: asset-publisher | gpt-realtime | nova-s2s | realtime-captioner
#       default: asset-publisher
#
# - AWS_PROFILE: named AWS CLI profile used to deploy the stack
#								 default: none (default profile is used)
#
# - STACK: stack name
#					 default: IVSVirtualParticipant-$(ENV)
#
# - ENV: the environment configuration that will be used to deploy the stack
#				 options: dev | prod
#				 default: dev

# Configuration options
VP           ?= asset-publisher
STACK        ?= IVSVirtualParticipant-$(ENV)
ENV          ?= dev
PUBLIC_API   ?= false

CDK_OPTIONS = $(if $(AWS_PROFILE), --profile $(AWS_PROFILE)) \
              --context stackName=$(STACK) \
              --context appEnv=$(ENV) \
              --context virtualParticipant=$(VP) \
              --context enablePublicApi=$(PUBLIC_API)

help: ## Shows this help message
	@echo "\n$$(tput bold)Available Rules:$$(tput sgr0)\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST)\
	 | sort \
	 | awk  \
	 'BEGIN {FS = ":.*?## "}; \
	 {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo "\n$$(tput bold)Note:$$(tput sgr0)\n"
	@echo "If AWS_PROFILE is not exported as an environment variable or provided through the command line, then the default AWS profile is used. \n" | fold -s
	@echo "   Option 1: export AWS_PROFILE=<profile>\n"
	@echo "   Option 2: AWS_PROFILE=<profile> make <target>\n"
	@echo "\n$$(tput bold)Virtual Participant Selection:$$(tput sgr0)\n"
	@echo "To deploy a specific virtual participant type:\n"
	@echo "   VP=asset-publisher make deploy  (default)\n"
	@echo "   VP=gpt-realtime make deploy\n"
	@echo "   VP=nova-s2s make deploy\n"
	@echo "   VP=realtime-captioner make deploy\n"

app: install bootstrap deploy ## Installs NPM dependencies, bootstraps, and deploys the stack

install: ## Installs NPM dependencies
	@echo "📦 Installing root NPM dependencies..."
	@npm install
	@echo "\n📦 Installing common library dependencies..."
	@npm install --prefix virtualparticipants/common
	@echo "\n📦 Installing $(VP) NPM dependencies..."
	@npm install --prefix virtualparticipants/$(VP)

bootstrap: guard-ENV guard-STACK ## Deploys the CDK Toolkit staging stack
	@echo "🥾 Bootstrapping..."
	npx cdk bootstrap $(CDK_OPTIONS)

deploy: guard-ENV guard-STACK ## Deploys the stack
	@echo "🚀 Deploying $(STACK) with $(VP)..."
	npx cdk deploy $(STACK) $(CDK_OPTIONS)

output: guard-ENV guard-STACK ## Retrieves the CloudFormation stack outputs
	@echo "🧲 Retrieving stack outputs for $(STACK)..."
	aws cloudformation describe-stacks --stack-name $(STACK) --query 'Stacks[].Outputs' --output=text

synth: guard-ENV guard-STACK ## Synthesizes the CDK app and produces a cloud assembly in cdk.out
	@echo "🧪 Synthesizing $(STACK) with $(VP)..."
	npx cdk synth $(STACK) $(CDK_OPTIONS)

diff: guard-ENV guard-STACK ## Compares the current version of a stack (and its dependencies) with the already-deployed version
	@echo "🧩 Diffing $(STACK) with $(VP)..."
	npx cdk diff $(STACK) $(CDK_OPTIONS)

destroy: guard-ENV guard-STACK clean ## Destroys the stack and cleans up
	@echo "🧨 Destroying $(STACK)..."
	npx cdk destroy $(STACK) $(CDK_OPTIONS)

clean: ## Deletes the build, dist and cloud assembly (cdk.out) directories
	@echo "🧹 Cleaning..."
	rm -rf dist cdk.out virtualparticipants/common/dist
	rm -rf virtualparticipants/asset-publisher/build virtualparticipants/asset-publisher/dist
	rm -rf virtualparticipants/gpt-realtime/build virtualparticipants/gpt-realtime/dist
	rm -rf virtualparticipants/nova-s2s/build virtualparticipants/nova-s2s/dist
	rm -rf virtualparticipants/realtime-captioner/build virtualparticipants/realtime-captioner/dist

guard-%:
	@ if [ "${${*}}" = "" ]; then \
		echo "Environment variable $* not set"; \
		exit 1; \
		fi
