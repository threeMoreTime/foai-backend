import smtplib
import imaplib
import os
import datetime
import glob
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from email.mime.text import MIMEText
import shutil

# --- 核心配置 ---
SMTP_SERVER = "smtp.gmail.com"
IMAP_SERVER = "imap.gmail.com"
SMTP_PORT = 587
SENDER_EMAIL = "moretimethree@gmail.com"
SENDER_PASSWORD = "stfewhnaaptdpolm"
RECEIVER_EMAIL = "moretimethree@gmail.com"

# 路径定义
BASE_DIR = "/root/foai-backend"
DB_PATH = f"{BASE_DIR}/foai_data.sqlite"
BACKUP_DIR = "/root/foai_configs_backup"
SEARCH_KEYWORD = "FOAI_FULL_BACKUP"

# 需要备份的配置文件列表
CONFIG_FILES = [
    f"{BASE_DIR}/docker-compose.yml",
    f"{BASE_DIR}/.env",
    f"{BASE_DIR}/nginx/default.conf"
]
# ----------------

SOP_CONTENT = """# FOAI 智能对话平台 - 全量迁移 SOP (2026版)

## 1. 恢复流程
1. **基础环境**: 安装 Docker, Compose, Certbot。
2. **文件解压**: 将邮件附件中的所有配置文件放回 `/root/foai-backend/` 对应位置。
3. **数据库**: 放置 `foai_data.sqlite` 并执行 `chmod 666`。
4. **SSL**: 运行 `certbot` 重新申请证书。
5. **启动**: `docker compose up -d`。
"""

def clean_remote_mail():
    try:
        mail = imaplib.IMAP4_SSL(IMAP_SERVER)
        mail.login(SENDER_EMAIL, SENDER_PASSWORD)
        mail.select("INBOX")
        status, data = mail.search(None, f'SUBJECT "{SEARCH_KEYWORD}"')
        if status == 'OK':
            for num in data[0].split():
                mail.store(num, '+FLAGS', '\\Deleted')
            mail.expunge()
            print("已清理远程旧邮件。")
        mail.close()
        mail.logout()
    except Exception as e:
        print(f"远程清理跳过: {e}")

def add_attachment(msg, file_path, display_name):
    if not os.path.exists(file_path):
        print(f"警告: 文件不存在，跳过附件: {display_name}")
        return
    with open(file_path, "rb") as f:
        part = MIMEBase('application', 'octet-stream')
        part.set_payload(f.read())
        encoders.encode_base64(part)
        part.add_header('Content-Disposition', f'attachment; filename="{display_name}"')
        msg.attach(part)

def send_backup():
    if not os.path.exists(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
        
    now = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    db_backup = f"{BACKUP_DIR}/foai_db_{now}.sqlite"
    sop_file = f"{BACKUP_DIR}/MIGRATION.md"
    
    # 1. 清理本地旧数据库备份
    for f in glob.glob(f"{BACKUP_DIR}/foai_db_*.sqlite"): os.remove(f)
    clean_remote_mail()
    
    # 2. 准备数据库和SOP
    shutil.copy2(DB_PATH, db_backup)
    with open(sop_file, "w", encoding="utf-8") as f: f.write(SOP_CONTENT)

    # 3. 构建邮件
    msg = MIMEMultipart()
    msg['From'] = SENDER_EMAIL
    msg['To'] = RECEIVER_EMAIL
    msg['Subject'] = f"🚀 {SEARCH_KEYWORD} - {now}"
    
    body = "FOAI 平台全量灾备包已生成。\n\n附件包含：\n1. SQLite 数据库\n2. Docker Compose 配置\n3. Nginx 站点配置\n4. .env 环境变量\n5. 流程化迁移 SOP"
    msg.attach(MIMEText(body, 'plain'))
    
    # 4. 依次挂载所有附件
    add_attachment(msg, db_backup, os.path.basename(db_backup))
    add_attachment(msg, sop_file, "MIGRATION.md")
    for config in CONFIG_FILES:
        add_attachment(msg, config, os.path.basename(config))
    
    # 5. 发送
    try:
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"成功：全量配置文件及备份已发送至 {RECEIVER_EMAIL}")
    except Exception as e:
        print(f"发送失败: {e}")

if __name__ == "__main__":
    send_backup()
