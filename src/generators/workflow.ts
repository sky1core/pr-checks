import fs from 'fs-extra';
import path from 'path';
import type { Config } from '../types/config.js';
import { generateWorkflows } from '../templates/index.js';
import { generateScriptFiles } from './scripts.js';

export interface GenerateResult {
  files: string[];
  workflowsDir: string;
}

export async function generateWorkflowFiles(cwd: string, config: Config): Promise<GenerateResult> {
  const platformDir = config.input.platform === 'gitea' ? '.gitea' : '.github';
  const workflowsDir = path.join(cwd, platformDir, 'workflows');

  try {
    await fs.ensureDir(workflowsDir);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`디렉토리 생성 실패: ${workflowsDir}\n${errorMessage}`);
  }

  const workflows = generateWorkflows(config);
  const files: string[] = [];

  // Generate workflow files
  for (const [filename, content] of Object.entries(workflows)) {
    if (content) {
      const filePath = path.join(workflowsDir, filename);
      try {
        await fs.writeFile(filePath, content, 'utf-8');
        files.push(path.relative(cwd, filePath));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`워크플로우 파일 쓰기 실패: ${filename}\n${errorMessage}`);
      }
    }
  }

  // Generate script files
  const scriptFiles = await generateScriptFiles(cwd, config);
  files.push(...scriptFiles);

  return { files, workflowsDir };
}
