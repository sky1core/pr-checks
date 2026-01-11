import type { Config } from '../types/config.js';
import { generateOverrideGateJob, generateRestoreGateJob } from './jobs/index.js';

export function generateApprovalOverrideWorkflow(config: Config): string {
  const { input } = config;

  const branchCondition = input.branches
    .map((b) => `github.event.pull_request.base.ref == '${b}'`)
    .join(' || ');

  return `name: Approval Override

on:
  pull_request_review:
    types: [submitted, dismissed]

jobs:
${generateOverrideGateJob(branchCondition)}

${generateRestoreGateJob(config, branchCondition)}
`;
}
