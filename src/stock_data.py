import yfinance as yf


def get_quote(ticker: str) -> dict | None:
    try:
        hist = yf.Ticker(ticker).history(period="5d")
    except Exception as e:
        print(f"[yfinance] '{ticker}' 조회 실패: {e}")
        return None

    if hist.empty:
        return None

    last_close = float(hist["Close"].iloc[-1])
    prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else last_close
    change_pct = (last_close - prev_close) / prev_close * 100 if prev_close else 0.0
    return {"price": last_close, "prev_close": prev_close, "change_pct": change_pct}


def format_price(ticker: str, price: float) -> str:
    if ticker.endswith((".KS", ".KQ")):
        return f"{price:,.0f}원"
    return f"${price:,.2f}"
