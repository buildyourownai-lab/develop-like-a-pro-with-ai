/** 새 거래일 게시 시각은 고정되지 않으므로 최신 기준일만 한 시간 간격으로 다시 확인한다. */
export const FSC_LATEST_DISCOVERY_TTL_SECONDS = 60 * 60;

/** 기준일이 request key에 고정된 일봉 snapshot은 원천의 일 단위 갱신 주기에 맞춘다. */
export const FSC_DAILY_SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;
