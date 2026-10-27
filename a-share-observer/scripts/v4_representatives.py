"""Curated, high-recognition A-share reference universe with observed daily prices.

Editorial categories are fixed and clearly separated from API facts. Ranking is
recomputed client-side using historical bars as-of each chosen trading day.
No future bars, invented prices, or look-ahead constituents are used.
"""
from __future__ import annotations
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as api

DATA = Path(__file__).resolve().parents[1] / "docs" / "data"
DEST = DATA / "representatives.json"
# Fixed economic style taxonomy. Manual classification, never inferred from the latest return.
ECONOMIC_STYLES = ["弹性成长", "景气成长", "稳定红利", "价格周期", "政策复苏"]
# [code, name, primary industry, economic style, concept tags]
RAW = [
("002594.SZ","比亚迪","汽车整车","景气成长","新能源汽车,智能驾驶"),
("601127.SH","赛力斯","汽车整车","弹性成长","新能源汽车,智能驾驶"),
("601633.SH","长城汽车","汽车整车","景气成长","新能源汽车,出口"),
("600104.SH","上汽集团","汽车整车","政策复苏","国企,新能源汽车"),
("300750.SZ","宁德时代","动力电池","景气成长","储能,新能源"),
("300014.SZ","亿纬锂能","动力电池","景气成长","储能,锂电池"),
("002460.SZ","赣锋锂业","锂矿材料","价格周期","锂电池,资源"),
("600519.SH","贵州茅台","白酒消费","稳定红利","消费,高端白酒"),
("000858.SZ","五粮液","白酒消费","政策复苏","消费,白酒"),
("600887.SH","伊利股份","食品饮料","稳定红利","消费,乳制品"),
("600276.SH","恒瑞医药","创新药","景气成长","创新药,出海"),
("603259.SH","药明康德","医药研发服务","弹性成长","医药,创新药产业链"),
("300760.SZ","迈瑞医疗","医疗器械","景气成长","医疗器械,出口"),
("000333.SZ","美的集团","家电制造","稳定红利","智能制造,消费,机器人"),
("000651.SZ","格力电器","家电制造","稳定红利","消费,家电"),
("600690.SH","海尔智家","家电制造","景气成长","消费,家电,出海"),
("601318.SH","中国平安","保险","政策复苏","金融,高股息"),
("600036.SH","招商银行","银行","稳定红利","金融,高股息"),
("601398.SH","工商银行","银行","稳定红利","金融,高股息"),
("600030.SH","中信证券","券商","政策复苏","金融,资本市场"),
("300059.SZ","东方财富","券商金融科技","弹性成长","金融科技,资本市场"),
("601899.SH","紫金矿业","有色金属","价格周期","黄金,铜,资源"),
("600547.SH","山东黄金","贵金属","价格周期","黄金,资源"),
("601088.SH","中国神华","能源煤炭","稳定红利","资源,高股息"),
("600028.SH","中国石化","油气能源","稳定红利","油气,高股息"),
("601857.SH","中国石油","油气能源","价格周期","油气,资源"),
("688981.SH","中芯国际","半导体制造","景气成长","半导体,国产替代"),
("002371.SZ","北方华创","半导体设备","景气成长","半导体,国产替代"),
("603986.SH","兆易创新","芯片设计","弹性成长","半导体,存储"),
("300308.SZ","中际旭创","光模块","弹性成长","AI算力,光通信"),
("300502.SZ","新易盛","光模块","弹性成长","AI算力,光通信"),
("601138.SH","工业富联","电子制造","景气成长","AI算力,服务器"),
("002415.SZ","海康威视","安防电子","政策复苏","人工智能,物联网"),
("002230.SZ","科大讯飞","人工智能","弹性成长","AI应用,大模型"),
("002475.SZ","立讯精密","消费电子","景气成长","消费电子,机器人"),
("300124.SZ","汇川技术","工业自动化","景气成长","机器人,工业自动化"),
("300024.SZ","机器人","机器人设备","弹性成长","机器人,工业自动化"),
("603728.SH","鸣志电器","电机装备","弹性成长","人形机器人,电机"),
("601012.SH","隆基绿能","光伏","政策复苏","新能源,光伏"),
("300274.SZ","阳光电源","光伏逆变器","景气成长","新能源,储能"),
("600438.SH","通威股份","光伏材料","价格周期","新能源,光伏"),
("601668.SH","中国建筑","建筑央企","稳定红利","基建,国企"),
("600048.SH","保利发展","房地产","政策复苏","地产,国企"),
("000002.SZ","万科A","房地产","政策复苏","地产"),
("601766.SH","中国中车","轨道交通","稳定红利","高端制造,国企"),
("002179.SZ","中航光电","军工电子","景气成长","国防军工,高端制造"),
("601888.SH","中国中免","旅游零售","政策复苏","消费,旅游"),
("002352.SZ","顺丰控股","快递物流","景气成长","物流,消费"),
]
def universe():
    return [{"code":c,"name":n,"industry":industry,"economic_style":style,
             "tags":tags.split(","),"editorial":True} for c,n,industry,style,tags in RAW]

def _bars(code, begin, end):
    # One stock per request, per officially documented API contract.
    response = api.client_get("/api/a-share/prices/historical",
        {"thscode":code, "interval":"1d", "start":begin, "end":end,
         "adjust":"forward"})
    rows=[]
    for item in response.get("item", []):
        if item.get("date_ms") is None: continue
        day=api.trading_date(item["date_ms"])
        close=api.num(item.get("close_price"))
        if close is None or close<=0: continue
        rows.append({"date":day,"close":round(close,4),
                     "open":api.num(item.get("open_price")),
                     "high":api.num(item.get("high_price")),
                     "low":api.num(item.get("low_price")),
                     "turnover_100m":round(item["turnover"]/1e8,3) if api.num(item.get("turnover")) is not None else None})
    return sorted({r["date"]:r for r in rows}.values(),key=lambda x:x["date"])

def main():
    DATA.mkdir(parents=True,exist_ok=True)
    previous={}
    if DEST.exists():
        try: previous=json.loads(DEST.read_text(encoding="utf-8"))
        except (OSError,ValueError): pass
    now=datetime.now(api.TZ)
    begin=api.since_ms((now-timedelta(days=180)).date())
    end=api.since_ms((now+timedelta(days=1)).date())
    selected=universe()
    # Explicit throttle/limit for initial API cost troubleshooting; default full roster.
    cap=int(os.getenv("V4_REP_LIMIT","0") or 0)
    if cap>0:selected=selected[:cap]
    collected=dict(previous.get("prices") or {})
    status={}
    def work(row):
        try:return row["code"],_bars(row["code"],begin,end),None
        except Exception as exc:return row["code"],None,type(exc).__name__
    with ThreadPoolExecutor(max_workers=max(1,min(3,int(os.getenv("V4_REP_WORKERS","2"))))) as pool:
        results=list(pool.map(work,selected))
    newest=None
    for code,bars,error in results:
        if bars:
            collected[code]=bars
            status[code]="complete"
            if newest is None or bars[-1]["date"]>newest:newest=bars[-1]["date"]
        else:
            status[code]="stale" if code in collected else "missing"
            print(f"WARN representative {code}: {error or 'empty'}; older valid bars retained")
    if not any(collected.get(x["code"]) for x in selected):
        raise RuntimeError("No representative history available; refusing to erase published file")
    # Keep canonical complete roster even if capped collection or API errors.
    result={"schema_version":1,"generated_at":now.isoformat(),"source":"hithink-finance / forward-adjusted daily K",
            "editorial_note":"股票观察池与经济风格/题材为人工固定分类，不是API官方身份；排名只依据真实日K，在本观察池内计算。",
            "economic_styles":ECONOMIC_STYLES,
            "universe":universe(),"prices":collected,
            "quality":{"requested":len(selected),"with_prices":sum(bool(collected.get(x["code"])) for x in selected),
                       "latest_available":newest,"per_stock":status}}
    temp=DEST.with_suffix(".json.tmp")
    temp.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":"),allow_nan=False),encoding="utf-8")
    temp.replace(DEST)
    print(json.dumps({"stocks_requested":len(selected),"available":result["quality"]["with_prices"],
                      "last_day":newest},ensure_ascii=False))

if __name__=="__main__":main()
