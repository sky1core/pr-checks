import type { Config } from '../types/config.js';
import { generatePrChecksWorkflow } from './pr-checks.js';
import { generateApprovalOverrideWorkflow } from './approval-override.js';

export interface GeneratedWorkflows {
  'pr-checks.yml': string;
  'pr-checks-approval.yml'?: string;
}

export function generateWorkflows(config: Config): GeneratedWorkflows {
  const workflows: GeneratedWorkflows = {
    'pr-checks.yml': generatePrChecksWorkflow(config),
  };

  if (config.input.generateApprovalOverride) {
    workflows['pr-checks-approval.yml'] = generateApprovalOverrideWorkflow(config);
  }

  return workflows;
}

export { generatePrChecksWorkflow, generateApprovalOverrideWorkflow };
