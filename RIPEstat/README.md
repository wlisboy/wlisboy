使用方式
```
# 参数
-a , --asn      目标自治系统号 (ASN)
-4, --ipv4      仅获取 IPv4 Prefix
-6, --ipv6      仅获取 IPv6 Prefix
-t , --time     过滤的起始日期 (例如: 20260701)
-o , --output   输出本地 CSV 的文件名 (例如: result.csv)
-
# 举例
py RIPEstat.py -a 906 -4 -t 20260701 -o result.csv
py RIPEstat.py -a 906 -6 -t 20260701 -o result.csv
```
