// 种子数据：一家店 + 常规菜单
// 幂等：重复执行不会产生重复数据
// 运行：npm run db:seed

import { PrismaClient } from "@prisma/client";

// 变量名兜底：与 src/lib/db-url.ts 保持一致的优先级
// （Vercel 的 Postgres 集成给的名字不完全统一）
const url = ["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"]
  .map((key) => process.env[key]?.trim())
  .find(Boolean);

const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : {});

async function main() {
  let shop = await prisma.shop.findFirst({ orderBy: { createdAt: "asc" } });
  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        name: "巷口咖啡",
        prepMinutes: 3,
        accepting: true,
        openTime: "07:00",
        closeTime: "20:00",
      },
    });
    console.log(`已创建店铺：${shop.name}（制作时长 ${shop.prepMinutes} 分钟）`);
  } else {
    console.log(`店铺已存在：${shop.name}，跳过创建`);
  }

  // sortOrder 决定「常点置顶」的顺序（不做搜索，见 docs/PRODUCT.md 非目标）
  const menu = [
    { name: "冰美式", size: "中杯", priceCents: 1500, sortOrder: 1 },
    { name: "燕麦拿铁", size: "中杯", priceCents: 2000, sortOrder: 2 },
    { name: "热拿铁", size: "中杯", priceCents: 1800, sortOrder: 3 },
    { name: "卡布奇诺", size: "中杯", priceCents: 1800, sortOrder: 4 },
    { name: "澳白", size: "中杯", priceCents: 2000, sortOrder: 5 },
    { name: "手冲单品", size: "中杯", priceCents: 2800, sortOrder: 20 },
    { name: "抹茶拿铁", size: "中杯", priceCents: 2200, sortOrder: 21 },
    { name: "热巧克力", size: "中杯", priceCents: 1800, sortOrder: 22 },
    { name: "柠檬气泡水", size: "中杯", priceCents: 1600, sortOrder: 23 },
    { name: "可颂", size: "单个", priceCents: 1200, sortOrder: 30 },
    { name: "提拉米苏", size: "单个", priceCents: 2600, sortOrder: 31 },
    { name: "曲奇", size: "两块", priceCents: 1000, sortOrder: 32 },
  ];

  let created = 0;
  for (const item of menu) {
    const exists = await prisma.drink.findFirst({
      where: { shopId: shop.id, name: item.name, size: item.size },
    });
    if (exists) continue;
    await prisma.drink.create({ data: { ...item, shopId: shop.id } });
    created++;
  }

  console.log(`菜单：新建 ${created} 项，跳过 ${menu.length - created} 项`);
  console.log(`当前菜单共 ${await prisma.drink.count({ where: { shopId: shop.id } })} 项`);
}

main()
  .catch((err) => {
    console.error("种子数据写入失败：", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
