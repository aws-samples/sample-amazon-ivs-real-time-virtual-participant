# IVS Virtual Participant Deployment CLI

An interactive command-line tool for deploying IVS Virtual Participant stacks with saved configuration management.

## Features

- 🎯 **Interactive Deployment Wizard** - Step-by-step guidance through deployment configuration
- 💾 **Configuration Management** - Save and reuse deployment configurations
- 🔄 **Quick Deploy** - Deploy using previously saved configurations
- 📋 **Configuration Listing** - View all saved deployment configurations
- 🗑️ **Configuration Deletion** - Remove unwanted saved configurations
- ✅ **Validation** - Input validation for all configuration parameters
- 🎨 **Beautiful UI** - Colorful and intuitive command-line interface

## Installation

The CLI tool is automatically available after installing project dependencies:

```bash
npm install
```

## Usage

### Interactive Deployment (Default)

Start the interactive deployment wizard:

```bash
npm run deploy:cli
```

This will:
1. Show existing saved configurations (if any)
2. Prompt for deployment parameters:
   - Virtual Participant Type (asset-publisher or gpt-realtime)
   - Environment (dev or prod)
   - Stack Name
   - AWS Profile
   - Public API setting
3. Option to save configuration for future use
4. Confirm deployment details
5. Execute deployment

### Deploy from Saved Configuration

Quickly deploy using a previously saved configuration:

```bash
npm run deploy:cli:use
```

This will:
1. List all saved configurations
2. Allow selection of a configuration
3. Option to modify before deploying
4. Execute deployment

### List Saved Configurations

View all saved deployment configurations:

```bash
npm run deploy:cli:list
```

This displays:
- Configuration name and ID
- Virtual participant type and environment
- Stack name and AWS profile
- Last deployment timestamp
- Deployment count

### Delete Saved Configuration

Remove a saved configuration:

```bash
npm run deploy:cli:delete
```

This will:
1. List all saved configurations
2. Allow selection of configuration to delete
3. Confirm deletion
4. Remove the configuration

## Configuration Parameters

### Virtual Participant Type

- **asset-publisher**: Publishes media assets to IVS stage
- **gpt-realtime**: GPT-powered real-time participant

### Environment

- **dev**: Development environment (default)
- **prod**: Production environment

### Stack Name

The CloudFormation stack name. Default format: `IVSVirtualParticipant-{environment}`

- Must start with a letter
- Can contain only alphanumeric characters and hyphens
- Maximum 128 characters

### AWS Profile

The AWS CLI profile to use for deployment. The tool automatically detects available profiles from your AWS configuration.

### Public API

Toggle whether to enable public API access:
- **Yes**: Enable public API endpoints
- **No**: Private API only (default)

## Saved Configurations

Configurations are stored locally using [Conf](https://github.com/sindresorhus/conf) and persist between CLI sessions. Each configuration includes:

- Unique ID (generated from environment and virtual participant type)
- Custom name (provided by user)
- All deployment parameters
- Last deployment timestamp
- Deployment count
- Creation timestamp

Configuration data is stored in your user config directory:
- macOS: `~/Library/Preferences/ivs-virtual-participant-deploy-nodejs/`
- Linux: `~/.config/ivs-virtual-participant-deploy-nodejs/`
- Windows: `%APPDATA%\ivs-virtual-participant-deploy-nodejs\`

## Integration with Makefile

The CLI tool integrates seamlessly with the existing Makefile deployment system. It:

1. Generates appropriate environment variables
2. Executes Make commands with the configured parameters
3. Maintains full backward compatibility
4. Allows direct Makefile usage if needed

Traditional Makefile deployment still works:
```bash
VP=gpt-realtime AWS_PROFILE=myprofile ENV=prod make deploy
```

## Examples

### Example 1: First-time Deployment

```bash
$ npm run deploy:cli

🚀 IVS Virtual Participant Deployment Tool

? Select Virtual Participant Type: gpt-realtime - GPT-powered real-time participant
? Select Environment: prod - Production environment
? Enter Stack Name: IVSVirtualParticipant-prod
? Select AWS Profile: production
? Enable Public API? No
? Save this configuration for future use? Yes
? Enter a name for this configuration: Production GPT Realtime

✓ Configuration saved as: Production GPT Realtime

📋 Deployment Configuration Summary:
─────────────────────────────────────
Virtual Participant: gpt-realtime
Environment:         prod
Stack Name:          IVSVirtualParticipant-prod
AWS Profile:         production
Public API:          No
─────────────────────────────────────

? Proceed with deployment? Yes

✅ Deployment completed successfully!
```

### Example 2: Deploy from Saved Configuration

```bash
$ npm run deploy:cli:use

🚀 Deploy from Saved Configuration

? Select a deployment configuration:
  Production GPT Realtime (gpt-realtime / prod) - Last deployed: 1/15/2025, 3:30:00 PM
❯ Dev Asset Publisher (asset-publisher / dev) - Last deployed: Never
  → Create new deployment configuration

✓ Selected: Dev Asset Publisher

? Would you like to modify this configuration before deploying? No

📋 Deployment Configuration Summary:
[...]

? Proceed with deployment? Yes

✅ Deployment completed successfully!
```

### Example 3: List Configurations

```bash
$ npm run deploy:cli:list

📋 Saved Deployment Configurations

────────────────────────────────────────────────────────────────────────────────

Production GPT Realtime
  ID: prod-gpt-realtime
  Virtual Participant: gpt-realtime
  Environment: prod
  Stack Name: IVSVirtualParticipant-prod
  AWS Profile: production
  Public API: Disabled
  Last Deployed: 1/15/2025, 3:30:00 PM
  Deploy Count: 5
  Created: 1/10/2025, 2:15:00 PM
────────────────────────────────────────────────────────────────────────────────

Total: 1 configuration(s)
```

## Troubleshooting

### AWS Profile Not Found

If you see an error about AWS profiles:
- Ensure you have AWS CLI installed
- Configure AWS credentials: `aws configure`
- Verify profiles: `aws configure list-profiles`

### Make Command Not Found

The CLI requires Make to be installed:
- macOS: Already included
- Linux: `sudo apt-get install make` or `sudo yum install make`
- Windows: Install via WSL or use Make for Windows

### Permission Denied

On Unix systems, if you encounter permission issues:
```bash
chmod +x scripts/deploy-cli/index.ts
```

## Architecture

The CLI tool is organized into modular components:

```
scripts/deploy-cli/
├── index.ts              # Main CLI entry point
├── commands/             # Command implementations
│   ├── deploy.ts         # Interactive deployment
│   ├── list.ts           # List configurations
│   ├── use.ts            # Deploy from saved config
│   └── delete.ts         # Delete configuration
├── lib/                  # Core libraries
│   ├── config-store.ts   # Configuration persistence
│   ├── prompts.ts        # Interactive prompts
│   ├── validator.ts      # Input validation
│   └── executor.ts       # Deployment execution
└── types/                # TypeScript definitions
    └── deployment.types.ts
```

## Contributing

When modifying the CLI tool:

1. Follow the existing code structure
2. Add proper TypeScript types
3. Update this README for new features
4. Test all commands thoroughly
5. Ensure backward compatibility with Makefile

## License

This tool is part of the IVS Virtual Participant project and follows the same MIT-0 license.
