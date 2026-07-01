import yfinance as yf
import json
from datetime import datetime, timezone

TICKERS = {
    "VWCE": "VWCE.DE",
    "VUAA": "VUAA.MI",
    "SEC0": "SEC0.DE",
    "C50":  "C50.PA",
}

def fetch():
    out = {}
    for name, symbol in TICKERS.items():
        try:
            hist = yf.Ticker(symbol).history(period="2d")
            if hist.empty:
                out[name] = {"error": "no data"}
                continue
            price = round(float(hist["Close"].iloc[-1]), 2)
            change = 0.0
            if len(hist) > 1:
                prev = float(hist["Close"].iloc[-2])
                change = round((price - prev) / prev * 100, 2)
            out[name] = {"price": price, "change_pct": change}
        except Exception as e:
            out[name] = {"error": str(e)}

    out["_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out

if __name__ == "__main__":
    data = fetch()
    print(json.dumps(data, indent=2))
    with open("dist/etf_prices.json", "w") as f:
        json.dump(data, f, indent=2)
    print("Salvato in dist/etf_prices.json")
