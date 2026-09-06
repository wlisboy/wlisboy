<img src=img.png>

🛠 Pages 上传 部署方法 **最佳推荐!!!** [图文教程](https://cmliussss.com/p/edt2/)

<details>
<summary><code><strong>「 Pages 上传文件部署文字教程 」</strong></code></summary>

1. 部署 CF Pages：
   - 下载 [edt_update.exe](https://raw.githubusercontent.com/wlisboy/wlisboy/main/edt_update/edt_update.exe) 文件，并点上 Star !!!
   - 在软件界面选择对应的版本 **(新手推荐: 稳定版)**
   - 在 CF Pages 控制台中选择 `上传资产`后，为你的项目 `取名` 后点击 `创建项目`，然后上传你下载好的**Pages.zip**文件后点击 `部署站点`。
   - 部署完成后点击 `继续处理站点` 后，选择 `设置` > `环境变量` > **制作**为生产环境定义变量 > `添加变量`。
     变量名称填写**ADMIN**，值则为你的管理员密码，后点击 `保存`即可。
   - 返回 `部署` 选项卡，在右下角点击 `创建新部署` 后，重新上传**Pages.zip**文件后点击 `保存并部署` 即可。

2. 绑定 KV 命名空间：
   - 在 `设置`选项卡中选择 `绑定` > `+ 添加` > `KV 命名空间`，然后选择一个已有的命名空间或创建一个新的命名空间进行绑定。
   - `变量名称`填写**KV**，然后点击 `保存`后重试部署即可。

3. 给 Pages绑定 CNAME自定义域：[视频教程](https://www.youtube.com/watch?v=LeT4jQUh8ok&t=851s)
   - 在 Pages控制台的 `自定义域`选项卡，下方点击 `设置自定义域`。
   - 填入你的自定义次级域名，注意不要使用你的根域名，例如：
     您分配到的域名是 `fuck.cloudns.biz`，则添加自定义域填入 `lizi.fuck.cloudns.biz`即可；
   - 按照 CF 的要求将返回你的域名DNS服务商，添加 该自定义域 `lizi`的 CNAME记录 `edgetunnel.pages.dev` 后，点击 `激活域`即可。
   
4. 访问后台：
   - 访问 `https://lizi.fuck.cloudns.biz/admin` 输入管理员密码即可登录后台。

</details>

### 参考项目 

[cmliu/edgetunnel](https://github.com/cmliu/edgetunnel)
