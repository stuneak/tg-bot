process.env.NTBA_FIX_319 = 'test';
const chromium = require('chrome-aws-lambda');
const telegram = require('./telegram');

const setTextInputValue = async (page, selector, value) => {
    await page.waitFor(selector);
    await page.type(selector, value);
};

let service = 'Подача документов на вид на жительство'
let dateArr = [];

const moveToLastStep = async ({ page }) => {
    await new Promise((r) => setTimeout(r, 1000));
    await page.waitFor('div[class="form-services--title js-services"');
    await page.click('div[class="form-services--title js-services"');
    await new Promise((r) => setTimeout(r, 1000));
    const [selectedCheckbox] = await page.$x(`//label[contains(., '${service}')]`);
    if (selectedCheckbox) {
        selectedCheckbox.evaluate(b => b.click());
    } else {
        throw Error(`Услуга ${service} не найдена`);
    }
    await new Promise((r) => setTimeout(r, 3000));
    await page.click('input[id="active-confirmation"');
    await page.click('.info-notification > button');
    await new Promise((r) => setTimeout(r, 1000));
    await page.click('.btn-next-step');
    await new Promise((r) => setTimeout(r, 1000));
}

const getAllDates = async ({ page }) => {
    let dates = [];
    const getCurrentDate = async () => {
        const days = await page.evaluate(() => {
            const elements = document.querySelectorAll(".cal-active");
            return Array.from(elements).map(element => element.dataset.day);
        });

        const date = await page.$eval('#display-month', el => el.innerText);
        dateArr.push(date);
        dates = dates.concat(days.map((day) => `${day} ${date}`));
    }

    let hasDisabled = false;
    while (!hasDisabled) {
        await getCurrentDate();
        hasDisabled = await page.$eval('.calendar-next', (button) => {
            return button.disabled;
        });
        if (!hasDisabled) {
            await page.click('button[class="calendar-next"');
            await new Promise((r) => setTimeout(r, 1000));
        }
    }

    return dates;
}

const run = async () => {
    let browser
    try {
        browser = await chromium.puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        await page.setViewport({
            width: 1420,
            height: 800,
        });

        await page.goto("https://pieraksts.mfa.gov.lv/ru/moskva/index", { waitUntil: "domcontentloaded" });

        await setTextInputValue(page, 'input[id="Persons[0][first_name]"]', "test");
        await setTextInputValue(page, 'input[id="Persons[0][last_name]"]', "test");
        await setTextInputValue(page, 'input[id="e_mail"]', "test@gmail.com");
        await setTextInputValue(page, 'input[id="phone"]', "+79990000000");

        await page.click('button[type="submit"]');
        await moveToLastStep({ page })

        const dates = await getAllDates({ page })

        await browser.close();

        return { dates: dates };
    } catch (e) {
        console.log(`Error handling: ${e.message}`);
        await browser && browser.close();
        return {
            error: `
Упс! Что-то пошло не так. 
Error message ${e.message}`
        }
    }
};


module.exports.processWebhook = async event => {
    const body = JSON.parse(event.body);

    if (body && body.message) {
        const { chat, text } = body.message;
        const matched = text.match(/\/check(\s?)(.*)?/);
        if (matched) {
            service = matched[2] || service;
            const res = await run();
            let message = ''
            if (res.error) {
                message = res.error;
            } else {
                message = `
Услуга: ${service}. 
Поиск по: ${dateArr.join('; ')}
Доступные даты: ${res.dates.length > 0 ? res.dates.join('\n') : "не найдено"}`
            }
            dateArr = [];
            await telegram.sendMessage({ chat_id: chat.id, text: res.error || message });
        }
    }

    return { statusCode: 200 };
};


