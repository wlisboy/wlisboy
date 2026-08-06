## 运行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-s` / `--skip` | off | 跳过 tracert 探测，直接进入测速整理 |
| `-f` / `--file` | — | 导入测试目标/IP 的文件（`*.txt`） |
| `-o` / `--output` | — | 导出测试结果的 CSV 文件 |
| `-u` / `--url` | `https://speed.cloudflare.com/__down?bytes=99999999` | 下载测速地址 |
| `-n` / `--num` | 200 | 数据过滤并发 workers |
| `-w` / `--worker` | 16 | tracert 匹配、数据筛选、延迟测速并发 workers  |
| `-m` / `--max-hops` | 8 | tracert 最大跳数；触发重试放宽至 25 |
| `-me` / `--max-empty` | 8 | tracert 连续无响应跳数上限 |
| `-ht` / `--timeout-hop` | 500 | tracert 单跳超时（毫秒）；触发重试放宽至 1000 |
| `-tt` / `--timeout-total` | 60000 | tracert 单目标总超时（毫秒）；触发重试放宽至 90000 |

## 使用方法

```
trace.exe -h
```

## 线路识别

| 特征 ASN | 运营商 | 线路类型 |
|----------|--------|----------|
| AS4134 | 中国电信 | 163骨干 |
| AS4812 | 中国电信 | CN2 |
| AS4809 | 中国电信 | CN2 GIA/GT |
| AS4837 | 中国联通 | 169骨干 |
| AS9929 | 中国联通 | CUII（A网） |
| AS9808 | 中国移动 | CMNET |
| AS58453 | 中国移动 | CMI |
| AS58807 | 中国移动 | CMIN2 |
| AS4538 | 中国教育网 | CERNET |
| AS7497 | 中国科技网 | CSTNET |

## 项目结构

```
Trace/
├── trace.exe              # 单文件可执行程序
├── main.exe               # Go 后端：并发 tracert、ASN 匹配、测速
└── data/
    ├── asn_prefixes.json      # ASN 路由前缀
    ├── locations.json         # 地区/城市/国家代码
    └── GeoLite2-ASN.mmdb      # ASN/组织 离线数据库
```
## 致谢（以下排名不分先后）

- [ASNIPtest](https://github.com/e13815332/ASNIPtest)
  
- [CFData-WEB](https://github.com/PoemMisty/CFData-WEB)

