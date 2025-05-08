// Google Apps Script (Code.gs)

// 全域變數
const SPREADSHEET_ID = '1HpCgjnx7nn8oVf50D8P1ONGrXoneszmZhPsGpafzb4A'; // ***** 請替換成您的 Google Sheet ID *****
const SHEET_NAME = '活動報到表';         // ***** 請替換成您的工作表名稱 *****
const SIGNATURE_FOLDER_NAME = '活動簽名圖片'; // Google Drive 中儲存簽名的資料夾名稱
const PARENT_FOLDER_ID = '1MMUawF3q2njoWbRezgIJwqocLBU5wYSA'; // ***** 替換成父資料夾ID，或留空 "" 代表根目錄 *****

/**
 * 當使用者開啟 Web App 時執行的主要函式
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('活動報到系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * 取得或建立用於儲存簽名的 Google Drive 資料夾
 * @return {Folder|null} Google Drive 資料夾物件，若父資料夾無效則返回 null
 */
function getOrCreateSignatureFolder() {
  let parentFolder;
  if (PARENT_FOLDER_ID) {
    try {
      parentFolder = DriveApp.getFolderById(PARENT_FOLDER_ID);
      if (!parentFolder) {
        Logger.log(`指定的父資料夾 ID 無效或找不到: ${PARENT_FOLDER_ID}。將在根目錄中操作。`);
        parentFolder = DriveApp.getRootFolder();
      }
    } catch (e) {
      Logger.log(`透過 ID 取得父資料夾時發生錯誤 (${PARENT_FOLDER_ID}): ${e.toString()}. Stack: ${e.stack}。將在根目錄中操作。`);
      parentFolder = DriveApp.getRootFolder();
    }
  } else {
    parentFolder = DriveApp.getRootFolder();
  }

  let signatureFolder;
  const folders = parentFolder.getFoldersByName(SIGNATURE_FOLDER_NAME);
  if (folders.hasNext()) {
    signatureFolder = folders.next();
  } else {
    signatureFolder = parentFolder.createFolder(SIGNATURE_FOLDER_NAME);
    Logger.log(`已在 '${parentFolder.getName()}' 資料夾下建立子資料夾：'${SIGNATURE_FOLDER_NAME}'`);
  }
  return signatureFolder;
}

/**
 * 將 Data URL 轉換並儲存為 Google Drive 中的圖片檔案
 * @param {string} dataUrl 簽名圖片的 Data URL
 * @param {string} fileName 儲存的檔案名稱
 * @return {string|null} 儲存成功後檔案的 URL，失敗則返回 null
 */
function saveSignatureToDrive(dataUrl, fileName) {
  try {
    const folder = getOrCreateSignatureFolder();
    if (!folder) {
        Logger.log('無法取得或建立簽名儲存資料夾。');
        return null;
    }
    const MimeType = dataUrl.substring(dataUrl.indexOf(':') + 1, dataUrl.indexOf(';'));
    const base64Data = dataUrl.substring(dataUrl.indexOf(',') + 1);
    const decodedData = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decodedData, MimeType, fileName);

    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileUrl = `https://drive.google.com/uc?export=view&id=${file.getId()}`;
    Logger.log(`簽名已儲存至 Drive: ${fileUrl} (位於資料夾: ${folder.getName()})`);
    return fileUrl;
  } catch (error) {
    Logger.log(`儲存簽名至 Drive 失敗: ${error.toString()} \nStack: ${error.stack}`);
    return null;
  }
}

/**
 * 從 Google Drive 檔案 ID 或 URL 獲取 Base64 Data URL
 * @param {string} fileIdentifier 檔案 ID 或完整的 Google Drive uc?id= URL
 * @return {string|null} Base64 Data URL (例如 data:image/png;base64,xxxxx) 或 null (若失敗)
 */
function getDriveFileAsBase64DataUrl(fileIdentifier) {
  let fileId = fileIdentifier;
  try {
    if (!fileIdentifier || typeof fileIdentifier !== 'string') {
        Logger.log(`提供的 fileIdentifier 無效: ${fileIdentifier}`);
        return null;
    }
    // 嘗試從 URL 中提取 File ID
    if (fileIdentifier.includes('drive.google.com') && fileIdentifier.includes('id=')) {
      const match = fileIdentifier.match(/id=([^&]+)/);
      if (match && match[1]) {
        fileId = match[1];
      } else {
        Logger.log(`無法從 URL 中提取有效的 File ID: ${fileIdentifier}`);
        // 如果無法提取ID，但它可能是個完整的URL，直接嘗試用 DriveApp 服務可能失敗
        // 此處假設如果包含 drive.google.com 但無法提取ID，則視為無效
        return null;
      }
    }
    // 如果 fileIdentifier 本身看起來不像 URL，則假設它就是 ID

    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const contentType = blob.getContentType();
    const base64Data = Utilities.base64Encode(blob.getBytes());
    const dataUrl = `data:${contentType};base64,${base64Data}`;
    Logger.log(`已從 Drive (ID: ${fileId}) 轉換檔案為 Base64 Data URL`);
    return dataUrl;
  } catch (error) {
    Logger.log(`從 Drive 轉換檔案為 Base64 失敗 (ID/URL: ${fileIdentifier}): ${error.toString()}. Stack: ${error.stack}`);
    return null;
  }
}

function MaskidNumber(idNumber) {
  const originalId = idNumber ? idNumber.toString().trim().toUpperCase() : "";
  if (originalId.length === 10) {
    const firstChar = originalId.charAt(0);
    const lastThreeChars = originalId.substring(originalId.length - 3);
    return `${firstChar}XXXXXX${lastThreeChars}`;
  } else {
    return originalId;
  }
}

/**
 * 根據參與者 ID 獲取參與者資料。
 * 電話欄位將被視為台灣身分證字號，並回傳遮罩後的格式。
 * @param {string} attendeeId 參與者ID
 * @return {object|null} 參與者資料物件，如果找不到則返回 null
 */
function getAttendeeData(attendeeId) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) {
      Logger.log('找不到工作表：' + SHEET_NAME);
      return { error: '伺服器錯誤：找不到工作表。' };
    }

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];
    const idHeader = 'id';
    const idNumberHeader = 'idNumber';
    const signatureFileUrlHeader = 'signatureFileUrl';
    attendeeId = attendeeId.toString().trim()

    const idColumnIndex = headers.indexOf(idHeader);
    if (idColumnIndex === -1) {
      return { error: '伺服器錯誤：資料表欄位設定不正確 ("id" 欄位缺失)。' };
    }

    const passHeaders = ['signature'];
    const processMapping = {
      [idNumberHeader]: MaskidNumber,
      [signatureFileUrlHeader]: (value) => {
        if (value) {
          const driveFileUrlOrId = value.toString();
          return getDriveFileAsBase64DataUrl(driveFileUrlOrId);
        }
        return null;
      }
    }

    for (let i = 1; i < values.length; i++) {
      const idValue = values[i][idColumnIndex];
      if (idValue && idValue.toString().trim() === attendeeId) {
        let attendee = {};
        headers.forEach((header, index) => {
          if (passHeaders.includes(header)) {
            return;
          }

          const cellValue = values[i][index];
          if (processMapping[header]) {
            attendee[header] = processMapping[header](cellValue);
          } else if (cellValue instanceof Date) {
            attendee[header] = cellValue.getTime();
          } else {
            attendee[header] = values[i][index];
          }
        });
        return attendee;
      }
    }
    return null;
  } catch (error) {
    Logger.log(`getAttendeeData 錯誤: ${error.toString()} \nStack: ${error.stack}`);
    return { error: '查詢資料時發生錯誤：' + error.toString() };
  }
}

/**
 * 記錄報到狀態和簽名 (儲存簽名至 Drive)
 * @param {string} attendeeId 參與者ID
 * @param {string} signatureDataUrl 簽名圖片的 Data URL (由前端傳來)
 * @return {object} 操作結果
 */
function recordCheckIn(attendeeId, signatureDataUrl) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) {
      Logger.log('找不到工作表：' + SHEET_NAME);
      return { success: false, message: '伺服器錯誤：找不到工作表。' };
    }
    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    const headers = values[0];
    const idColumnIndex = headers.indexOf('id');
    const statusColumnIndex = headers.indexOf('checkInStatus');
    const timestampColumnIndex = headers.indexOf('signatureTimestamp');
    const signatureFileUrlColumnIndex = headers.indexOf('signatureFileUrl');
    const signatureColumnIndex = headers.indexOf('signature');

    const requiredColumns = ['id', 'checkInStatus', 'signatureTimestamp', 'signatureFileUrl', 'signature'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));

    if (missingColumns.length > 0) {
      const errorMessage = `一個或多個必要欄位找不到: ${missingColumns.join(', ')}`;
      Logger.log(errorMessage);
      return { success: false, message: `伺服器錯誤：資料表欄位設定不正確 (缺少: ${missingColumns.join(', ')})。` };
    }

    for (let i = 1; i < values.length; i++) {
      const idValue = values[i][idColumnIndex];
      if (idValue && idValue.toString().trim() === attendeeId.toString().trim()) {
        if (values[i][statusColumnIndex] === '已報到') {
          if (values[i][timestampColumnIndex] && values[i][signatureFileUrlColumnIndex]) {
            return { success: false, message: '此ID已完成報到，若需更新請聯繫管理員。' };
          }
        }

        const timestamp = new Date();
        const fileName = `signature_${attendeeId}_${timestamp.getTime()}.png`;
        const driveFileUrl = saveSignatureToDrive(signatureDataUrl, fileName);

        if (!driveFileUrl) {
          return { success: false, message: '儲存簽名圖片失敗，請稍後再試或聯絡管理員。' };
        }

        sheet.getRange(i + 1, statusColumnIndex + 1).setValue('已報到');
        sheet.getRange(i + 1, timestampColumnIndex + 1).setValue(timestamp);
        sheet.getRange(i + 1, signatureFileUrlColumnIndex + 1).setValue(driveFileUrl);
        sheet.getRange(i + 1, signatureColumnIndex + 1).setValue(`=image("${driveFileUrl}")`);

        SpreadsheetApp.flush();
        return { success: true, message: '報到成功！感謝您的參與。簽名已儲存。' };
      }
    }
    return { success: false, message: '找不到您的報名資料，請確認ID是否正確。' };
  } catch (error) {
    Logger.log(`recordCheckIn 錯誤: ${error.toString()} \nStack: ${error.stack}`);
    return { success: false, message: '記錄報到時發生錯誤：' + error.toString() };
  }
}
