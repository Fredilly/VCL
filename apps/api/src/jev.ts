export type JevNoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria?: {
    true: string;
    false: string;
  };
};

export type JevChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

export type JevScoreQuestion = {
  type: 'score';
  instructions: string;
  criteria: Record<string, string> | string[];
};

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;
export type JevQuestions = Record<string, JevQuestion>;

export interface WorkersAiBinding {
  run(model: string, input: {
    state: unknown;
    questions: JevQuestions;
  }): Promise<unknown>;
}

export interface JevEvaluationInput {
  state: unknown;
  questions: JevQuestions;
}

export class JevJudgmentProvider {
  static readonly model = 'typesafe/jev';

  constructor(private readonly ai: WorkersAiBinding) {}

  evaluate(input: JevEvaluationInput): Promise<unknown> {
    return this.ai.run(JevJudgmentProvider.model, input);
  }
}
