export type TradeFailure =
  | { reason: "trade_forbidden"; tradeId: number }
  | { reason: "trade_not_active"; tradeId: number }
  | { reason: "trade_not_found"; tradeId: number }
  | { reason: "unknown_instrument"; symbol: string }
  | { reason: "unknown_counterparty"; counterparty: string }
  | { reason: "unknown_book"; book: string }
  | { reason: "unknown_trader"; traderCode: string }
  | { reason: "recorder_not_found"; recorderId: number };

export class TradeError extends Error {
  readonly failure: TradeFailure;

  constructor(failure: TradeFailure) {
    let message: string;
    switch (failure.reason) {
      case "trade_not_found":
        message = "Trade not found.";
        break;
      case "trade_forbidden":
        message = "Only the recorder can change this trade.";
        break;
      case "trade_not_active":
        message = "Only active trades can be changed.";
        break;
      case "unknown_instrument":
        message = "Unknown symbol.";
        break;
      case "unknown_counterparty":
        message = "Unknown counterparty.";
        break;
      case "unknown_book":
        message = "Unknown book.";
        break;
      case "unknown_trader":
        message = "Unknown trader code.";
        break;
      case "recorder_not_found":
        message = "Recorder not found.";
        break;
    }
    super(message);
    this.name = "TradeError";
    this.failure = failure;
  }
}
