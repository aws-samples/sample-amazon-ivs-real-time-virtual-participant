enum API_EXCEPTION {
  BAD_INPUT = 'BadInputException',
  BUCKET_NAME_MISSING = 'BucketNameMissingException',
  BUCKET_NOT_FOUND = 'BucketNotFoundException',
  STAGE_NOT_FOUND = 'StageNotFoundException',
  STAGE_ID_MISSING = 'StageIdMissingException',
  VP_NOT_FOUND = 'VpNotFoundException',
  VP_ALREADY_ASSIGNED = 'VpAlreadyAssignedException',
  VP_NOT_AVAILABLE = 'VpNotAvailableException',
  TOKEN_CONFIGURATION_LIMIT_EXCEEDED_EXCEPTION = 'TokenConfigurationLimitExceededException'
}

const MAX_TOKEN_CONFIGURATIONS = 2;

const PARTICIPANT_TOKEN_DURATION_IN_MINUTES = 10_080; // 1 week

const RESOURCE_TAGS = { stack: process.env.STACK! };

export {
  API_EXCEPTION,
  MAX_TOKEN_CONFIGURATIONS,
  PARTICIPANT_TOKEN_DURATION_IN_MINUTES,
  RESOURCE_TAGS
};
