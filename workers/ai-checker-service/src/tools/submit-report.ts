import { tool } from 'ai';
import { z } from 'zod';

export const submitReportTool = tool({
  description: 'Submit the final fact-checking report. Use this when you have completed your investigation.',
  parameters: z.object({
    report: z.string().describe('The complete fact-checking report in markdown format'),
    sources: z.array(z.string().url()).describe('Array of source URLs cited in the report'),
    isControversial: z.boolean().describe('Whether the topic is controversial or has disputed claims'),
  }),
  execute: async ({ report, sources, isControversial }) => {
    // This tool signals the agent loop to exit
    // The result is captured by the agent loop's onStepFinish handler

    return {
      report,
      sources,
      isControversial,
    };
  },
});
