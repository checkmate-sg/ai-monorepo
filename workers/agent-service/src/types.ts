export interface ReviewResponse {
  success: true;
  result: {
    feedback: string;
    passedReview: boolean;
  };
}

export interface ReviewErrorResponse {
  success: false;
  error: {
    message: string;
  };
}

export type ReviewResult = ReviewResponse | ReviewErrorResponse;
