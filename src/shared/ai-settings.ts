export type AiMode = 'site' | 'personal' | 'disabled';
export type PersonalAiSettings = {
  mode: AiMode;
  revision: number;
  hasKey: boolean;
  baseUrl: string;
  model: string;
  inputPrice: number;
  outputPrice: number;
  dailyBudget: number;
  monthlyBudget: number;
  allowedBaseUrls: string[];
  siteAvailable: boolean;
  personalAvailable: boolean;
  effectiveMode: AiMode;
};

export type PersonalAiInput = Pick<
  PersonalAiSettings,
  | 'mode'
  | 'revision'
  | 'baseUrl'
  | 'model'
  | 'inputPrice'
  | 'outputPrice'
  | 'dailyBudget'
  | 'monthlyBudget'
> & { apiKey?: string };
