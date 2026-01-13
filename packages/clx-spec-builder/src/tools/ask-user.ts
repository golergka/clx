// ask_user tool - blocks and prompts user for input

import { tool } from 'ai';
import { z } from 'zod';
import * as readline from 'readline';

async function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`\n${prompt}\n> `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export const askUserTool = tool({
  description: 'Ask the user a question and wait for their response. Use this when you need clarification, credentials, or any other input from the user.',
  parameters: z.object({
    question: z.string().describe('The question to ask the user'),
  }),
  execute: async ({ question }) => {
    console.log('\n[Agent is asking for input]');
    const answer = await askQuestion(question);
    return { answer };
  },
});
