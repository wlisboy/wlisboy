## 运行参数
| 参数 | 长参数 | 类型 | 必选 | 说明 |
|------|--------|------|------|------|
| `-4` | `--ipv4` | flag | 二选一 | 查询 IPv4 Prefix |
| `-6` | `--ipv6` | flag | 二选一 | 查询 IPv6 Prefix |
| `-a` | `--asn` | int | ✓ | 目标 ASN（如 `906`） |
| `-t` | `--time` | str | ✓ | 目标日期（如 `20260722`） |
| `-o` | `--output` | str | ✓ | 输出 CSV 文件名（如 `result.csv`） |

## 使用方式
```
RIPEstat.exe -4 -t 20260722 -a 906 -o as906_v4.csv
RIPEstat.exe -6 -t 20260722 -a 906 -o as906_v6.csv
```
## 致谢
[RIPEstat](https://stat.ripe.net)
