// Embedding related types
export interface EmbedRequest {
  text: string;
  id?: string;
  model?: keyof AiModels;
}

export interface EmbedResponse {
  embedding: number[];
  model: keyof AiModels;
  id?: string;
}
