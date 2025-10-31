/**
 * Configuration storage manager using Conf for persistent local storage
 */

import Conf from 'conf';

import type {
  DeploymentConfig,
  DeploymentStore,
  SavedDeployment
} from '../types/deployment.types.js';

export class ConfigStore {
  private store: Conf<DeploymentStore>;

  constructor() {
    this.store = new Conf<DeploymentStore>({
      projectName: 'ivs-virtual-participant-deploy',
      defaults: {
        deployments: {}
      }
    });
  }

  /**
   * Save a deployment configuration
   */
  saveDeployment(
    id: string,
    name: string,
    config: DeploymentConfig
  ): SavedDeployment {
    const deployments = this.store.get('deployments');
    const existing = deployments[id];

    const deployment: SavedDeployment = {
      id,
      name,
      config,
      lastDeployed: new Date().toISOString(),
      deployCount: existing ? existing.deployCount + 1 : 1,
      createdAt: existing?.createdAt || new Date().toISOString()
    };

    deployments[id] = deployment;
    this.store.set('deployments', deployments);

    return deployment;
  }

  /**
   * Get a deployment configuration by ID
   */
  getDeployment(id: string): SavedDeployment | undefined {
    const deployments = this.store.get('deployments');

    return deployments[id];
  }

  /**
   * List all saved deployment configurations
   */
  listDeployments(): SavedDeployment[] {
    const deployments = this.store.get('deployments');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const deploymentList = Object.values(deployments) as SavedDeployment[];

    return deploymentList.sort(
      (a, b) =>
        new Date(b.lastDeployed ?? b.createdAt).getTime() -
        new Date(a.lastDeployed ?? a.createdAt).getTime()
    );
  }

  /**
   * Delete a deployment configuration
   */
  deleteDeployment(id: string): boolean {
    const deployments = this.store.get('deployments');

    if (deployments[id]) {
      delete deployments[id];
      this.store.set('deployments', deployments);

      return true;
    }

    return false;
  }

  /**
   * Update last deployed timestamp for a configuration
   */
  updateLastDeployed(id: string): void {
    const deployments = this.store.get('deployments');

    if (deployments[id]) {
      deployments[id].lastDeployed = new Date().toISOString();
      deployments[id].deployCount++;
      this.store.set('deployments', deployments);
    }
  }

  /**
   * Check if a deployment configuration exists
   */
  hasDeployment(id: string): boolean {
    const deployments = this.store.get('deployments');

    return !!deployments[id];
  }

  /**
   * Clear all saved configurations (mainly for testing)
   */
  clearAll(): void {
    this.store.set('deployments', {});
  }
}
