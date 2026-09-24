Запуск

```bash
# 1) База (локальный Postgres должен быть запущен; либо docker compose up -d db)
createdb -O certrecord certrecord   # один раз, если базы нет

# 2) Backend
cd server
npm install
cp -n .env.example .env   # DATABASE_URL уже настроен на локальный Postgres
npx prisma migrate dev    # таблицы
npm run seed              # перенос/живой скан сертификатов
npm run dev               # http://localhost:3000

# 3) Frontend
cd client
npm install
npm run dev               # http://localhost:5173
```

Настройка

Для SMTP_PASS и SMTP_USER в .env зайдите https://account.mail.ru/user/2-step-auth/passwords/ и создайте пароли для внешних приложений