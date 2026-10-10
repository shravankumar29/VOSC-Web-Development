const ITEMS_KEY = "lf_items";
const FILE_DB = "lf_file_store";
const FILE_STORE = "files";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
let objectUrls = [];

const getItems = () => JSON.parse(localStorage.getItem(ITEMS_KEY) || "[]");
const saveItems = x => localStorage.setItem(ITEMS_KEY, JSON.stringify(x));
const user = () => JSON.parse(localStorage.getItem("lf_currentUser") || "null");
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const fmt = d => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}) : "—";
const formatBytes = n => n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const cleanText = s => String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");

function textDistance(a, b){
  if(a === b) return 0;
  if(!a.length) return b.length;
  if(!b.length) return a.length;
  const row = Array.from({length: a.length + 1}, (_, i) => i);
  for(let i = 1; i <= b.length; i++){
    let prev = row[0]; row[0] = i;
    for(let j = 1; j <= a.length; j++){
      const temp = row[j];
      row[j] = b[i - 1] === a[j - 1] ? prev : Math.min(prev + 1, row[j] + 1, row[j - 1] + 1);
      prev = temp;
    }
  }
  return row[a.length];
}

function isSimilarName(a, b){
  const s1 = cleanText(a), s2 = cleanText(b);
  if(!s1 || !s2) return false;
  if(s1 === s2) return true;
  const minLen = Math.min(s1.length, s2.length);
  const maxLen = Math.max(s1.length, s2.length);
  if(minLen >= 4 && (s1.includes(s2) || s2.includes(s1))) return true;
  const dist = textDistance(s1, s2);
  return dist <= 2 && (1 - dist / maxLen) >= 0.75;
}

function isSimilarPlace(a, b){
  const s1 = cleanText(a), s2 = cleanText(b);
  if(!s1 || !s2) return false;
  if(s1 === s2) return true;
  const minLen = Math.min(s1.length, s2.length);
  if(minLen >= 4 && (s1.includes(s2) || s2.includes(s1))) return true;
  return textDistance(s1, s2) <= 2;
}

function isCloseDate(d1, d2, maxDays = 2){
  if(!d1 || !d2) return false;
  if(d1 === d2) return true;
  const t1 = new Date(d1 + "T00:00:00").getTime();
  const t2 = new Date(d2 + "T00:00:00").getTime();
  if(isNaN(t1) || isNaN(t2)) return false;
  return Math.abs(t1 - t2) / (1000 * 60 * 60 * 24) <= maxDays;
}

function findDuplicateReport(newItem, excludeId){
  return getItems().find(item => {
    if(excludeId && item.id === excludeId) return false;
    if(item.type !== newItem.type) return false;
    if(!isSimilarName(item.name, newItem.name)) return false;
    if(!isSimilarPlace(item.place, newItem.place)) return false;
    if(!isCloseDate(item.date, newItem.date)) return false;
    return true;
  });
}

function requireUser(){
  if(!user()){ location.href="login.html"; return false; }
  return true;
}

function openFileDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB) return reject(new Error("IndexedDB is not supported in this browser."));
    const request = indexedDB.open(FILE_DB, 1);
    request.onupgradeneeded = () => {
      if(!request.result.objectStoreNames.contains(FILE_STORE)) request.result.createObjectStore(FILE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open file storage."));
  });
}

async function saveFile(id, file){
  const db = await openFileDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(FILE_STORE,"readwrite");
    tx.objectStore(FILE_STORE).put({blob:file,name:file.name,type:file.type,size:file.size}, id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not save file.")); };
  });
}

async function getFile(id){
  if(!id) return null;
  const db = await openFileDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(FILE_STORE,"readonly");
    const req = tx.objectStore(FILE_STORE).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error || new Error("Could not read file.")); };
  });
}

async function deleteFile(id){
  if(!id) return;
  try{
    const db = await openFileDB();
    await new Promise((resolve,reject)=>{
      const tx = db.transaction(FILE_STORE,"readwrite");
      tx.objectStore(FILE_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }catch(e){ console.warn("File cleanup failed",e); }
}

function clearObjectUrls(){
  objectUrls.forEach(u => URL.revokeObjectURL(u));
  objectUrls = [];
}

async function fileMarkup(i, className="item-image"){
  const file = i.fileId ? await getFile(i.fileId) : null;
  if(file){
    const url = URL.createObjectURL(file.blob);
    objectUrls.push(url);
    if((file.type || "").startsWith("image/")) return `<div class="${className}"><img src="${url}" alt="${esc(i.name)}"><span class="pill ${i.type}">${i.type.toUpperCase()}</span></div>`;
    return `<div class="${className} file-placeholder"><div>📎</div><strong>${esc(file.name)}</strong><small>${esc(formatBytes(file.size))}</small><span class="pill ${i.type}">${i.type.toUpperCase()}</span></div>`;
  }
  if(i.image){
    return `<div class="${className}"><img src="${i.image}" alt="${esc(i.name)}"><span class="pill ${i.type}">${i.type.toUpperCase()}</span></div>`;
  }
  return `<div class="${className}"><span>◎</span><span class="pill ${i.type}">${i.type.toUpperCase()}</span></div>`;
}

async function card(i, manage=false){
  const media = await fileMarkup(i);
  return `<article class="item-card">${media}<div class="item-body"><div class="item-meta"><span>${esc(fmt(i.date))}</span><span>•</span><span>${esc(i.place)}</span></div><h3>${esc(i.name)}</h3><p>${esc(i.description)}</p><div class="card-bottom"><span class="status ${i.status}">${esc(i.status)}</span><a href="item-details.html?id=${encodeURIComponent(i.id)}">View details →</a></div>${manage?`<div class="manage-actions"><button data-action="edit" data-id="${i.id}">Edit</button><button data-action="delete" data-id="${i.id}">Delete</button><button data-action="recover" data-id="${i.id}">${i.status==="recovered"?"Recovered":"Mark recovered"}</button></div>`:""}</div></article>`;
}

async function renderList(list,el){
  clearObjectUrls();
  if(!list.length){el.innerHTML=`<div class="empty-state"><div>⌕</div><h3>No reports found</h3><p>Try another search or report an item yourself.</p></div>`;return;}
  el.innerHTML = (await Promise.all(list.map(i=>card(i)))).join("");
}

function initItems(){
  const grid=document.getElementById("itemsGrid");
  if(!grid)return;
  const search=document.getElementById("searchInput"),filter=document.getElementById("typeFilter"),count=document.getElementById("itemsCount");
  const run=async()=>{
    const q=search.value.toLowerCase().trim(),t=filter.value;
    const list=getItems().filter(i=>(t==="all"||i.type===t)&&(!q||`${i.name} ${i.description} ${i.place}`.toLowerCase().includes(q)));
    count.textContent=`${list.length} report${list.length!==1?"s":""}`;
    await renderList(list,grid);
  };
  search.addEventListener("input",run);filter.addEventListener("change",run);
  document.getElementById("clearFilters").addEventListener("click",()=>{search.value="";filter.value="all";run()});
  run();
}

function initReport(){
  if(!requireUser())return;
  const form=document.getElementById("reportForm");if(!form)return;
  const itemDate = document.getElementById("itemDate");
  itemDate.max = getToday();
  let bypassDuplicate = false;
  [itemName, itemDate, itemPlace, itemDescription].forEach(el => {
    if(el) el.addEventListener("input", () => {
      bypassDuplicate = false;
      const m = document.getElementById("reportMessage");
      if(m && m.querySelector(".duplicate-warning")) m.innerHTML = "";
    });
  });
  const params=new URLSearchParams(location.search),editId=params.get("edit"),currentUser=user(),targetItem=editId?getItems().find(x=>x.id===editId):null;
  if(editId&&(!targetItem||!currentUser||targetItem.reportedBy!==currentUser.email)){location.href="my-reports.html";return;}
  const existing=targetItem,type=(existing?existing.type:params.get("type")==="found"?"found":"lost");
  document.getElementById("reportTitle").textContent=existing?`Edit your ${type} report`:`Report a ${type} item`;
  document.getElementById("reportEyebrow").textContent=existing?"EDIT REPORT":type==="lost"?"REPORT LOST ITEM":"REPORT FOUND ITEM";
  if(existing){
    itemName.value=existing.name;itemDate.value=existing.date;itemPlace.value=existing.place;itemDescription.value=existing.description;itemContact.value=existing.contact;
    document.getElementById("imagePreview").innerHTML=existing.fileName?`<span class="upload-icon">📎</span><strong>${esc(existing.fileName)}</strong><small>Current attachment · choose a new file to replace it</small>`:existing.image?`<img src="${existing.image}" alt="Current image">`:document.getElementById("imagePreview").innerHTML;
  }

  const input=document.getElementById("itemImage");
  input.addEventListener("change",e=>{
    const f=e.target.files[0];
    const msg=document.getElementById("reportMessage");
    msg.textContent="";
    if(!f)return;
    if(f.size>MAX_FILE_SIZE){e.target.value="";msg.textContent="File is too large. Please choose a file up to 10 MB.";return;}
    document.getElementById("imagePreview").innerHTML=`<span class="upload-icon">${f.type.startsWith("image/")?"🖼":"📎"}</span><strong>${esc(f.name)}</strong><small>${esc(f.type||"File")} · ${esc(formatBytes(f.size))}</small>`;
    if(f.type.startsWith("image/")){
      const r=new FileReader();
      r.onload=()=>{document.getElementById("imagePreview").innerHTML=`<img src="${r.result}" alt="Preview"><small>${esc(f.name)} · ${esc(formatBytes(f.size))}</small>`};
      r.readAsDataURL(f);
    }
  });

  form.addEventListener("submit",async e=>{
    e.preventDefault();
    const msg=document.getElementById("reportMessage"),button=form.querySelector('button[type="submit"]'),file=input.files[0];
    msg.textContent="";
    if(!itemName.value.trim()||!itemDescription.value.trim()||!itemDate.value||!itemPlace.value.trim()||!itemContact.value.trim()){
      msg.textContent="Please complete all required fields.";return;
    }
    if (itemDate.value > getToday()) { msg.textContent = "Date cannot be in the future."; return; }
    if(file&&file.size>MAX_FILE_SIZE){msg.textContent="File is too large. Maximum size is 10 MB.";return;}
    if(existing){
      const currentU=user();
      const currentItem=getItems().find(x=>x.id===existing.id);
      if(!currentItem||!currentU||currentItem.reportedBy!==currentU.email){
        msg.textContent="You do not have permission to edit this report.";
        return;
      }
    }

    if(!bypassDuplicate){
      const potentialDup=findDuplicateReport({
        type,
        name: itemName.value.trim(),
        place: itemPlace.value.trim(),
        date: itemDate.value
      }, existing?.id);
      if(potentialDup){
        msg.innerHTML = `<div class="duplicate-warning" style="background:#fffbe6;border:1px solid #ffe58f;border-radius:12px;padding:14px;color:var(--ink);margin:10px 0;text-align:left;"><div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:#d46b08;">⚠️ Potential duplicate report found</div><p style="margin:0 0 12px;font-size:12px;color:var(--muted);line-height:1.4;">A matching ${esc(potentialDup.type)} report for <strong>"${esc(potentialDup.name)}"</strong> at <strong>"${esc(potentialDup.place)}"</strong> (${esc(fmt(potentialDup.date))}) already exists.</p><div style="display:flex;gap:8px;flex-wrap:wrap;"><a href="item-details.html?id=${encodeURIComponent(potentialDup.id)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:12px;text-decoration:none;">View existing report ↗</a><button type="button" id="continueDuplicateBtn" class="btn btn-primary btn-sm" style="font-size:12px;">Publish anyway →</button></div></div>`;
        const continueBtn = document.getElementById("continueDuplicateBtn");
        if(continueBtn){
          continueBtn.onclick = () => {
            bypassDuplicate = true;
            button.click();
          };
        }
        return;
      }
    }
    button.disabled=true;button.textContent="Publishing…";
    try{
      const id=existing?existing.id:(crypto.randomUUID?crypto.randomUUID():Date.now().toString());
      let fileId=existing?.fileId||"",fileName=existing?.fileName||"",fileType=existing?.fileType||"",fileSize=existing?.fileSize||0;
      if(file){
        fileId=`file_${id}`;
        await saveFile(fileId,file);
        fileName=file.name;fileType=file.type;fileSize=file.size;
      }
      const item={id,type,name:itemName.value.trim(),description:itemDescription.value.trim(),date:itemDate.value,place:itemPlace.value.trim(),contact:itemContact.value.trim(),fileId,fileName,fileType,fileSize,image:existing?.image||"",reportedBy:existing?existing.reportedBy:user().email,reporterName:existing?existing.reporterName:user().name,status:existing?.status||"active",createdAt:existing?.createdAt||Date.now()};
      const items=getItems();
      if(existing){
        const idx=items.findIndex(x=>x.id===existing.id&&x.reportedBy===user()?.email);
        if(idx>=0)items[idx]=item;
        else{
          msg.textContent="You do not have permission to edit this report.";
          button.disabled=false;button.textContent="Publish report →";
          return;
        }
      }else items.unshift(item);
      saveItems(items);
      location.href=existing?"my-reports.html":"items.html";
    }catch(err){
      console.error(err);
      msg.textContent="Could not publish this report. Please try again with a smaller file or another browser.";
      button.disabled=false;button.textContent="Publish report →";
    }
  });
}

async function initDetails(){
  const box=document.getElementById("detailContent");if(!box)return;
  const id=new URLSearchParams(location.search).get("id"),i=getItems().find(x=>x.id===id);
  if(!i){box.innerHTML='<div class="empty-state"><h3>Report not found</h3><a href="items.html">Back to reports</a></div>';return;}
  clearObjectUrls();
  const file= i.fileId ? await getFile(i.fileId) : null;
  let photo="<span>◎</span>";
  if(file){
    const url=URL.createObjectURL(file.blob);objectUrls.push(url);
    photo=(file.type||"").startsWith("image/")?`<img src="${url}" alt="${esc(i.name)}">`:`<div class="file-detail"><div>📎</div><strong>${esc(file.name)}</strong><small>${esc(formatBytes(file.size))}</small><a class="btn btn-secondary" href="${url}" download="${esc(file.name)}">Download file</a></div>`;
  }else if(i.image) photo=`<img src="${i.image}" alt="${esc(i.name)}">`;
  const u=user(),isOwner=!!(u?.email&&i.reportedBy===u.email),canClaim=!!u&&!isOwner&&i.status==="active";
  box.innerHTML=`<div class="detail-grid"><div class="detail-photo">${photo}</div><div class="detail-info"><div class="detail-top"><span class="pill ${i.type}">${i.type.toUpperCase()}</span><span class="status ${i.status}">${i.status}</span></div><h1>${esc(i.name)}</h1><p class="detail-description">${esc(i.description)}</p><div class="detail-facts"><div><small>DATE</small><strong>${esc(fmt(i.date))}</strong></div><div><small>PLACE</small><strong>${esc(i.place)}</strong></div><div><small>REPORTED BY</small><strong>${esc(i.reporterName)}</strong></div></div><div class="contact-box"><div><small>CONTACT</small><strong>${esc(i.contact)}</strong></div><a class="btn btn-primary" href="mailto:${encodeURIComponent(i.contact)}?subject=Regarding your ${encodeURIComponent(i.name)} report">Contact reporter →</a></div>${isOwner?`<a href="report.html?edit=${encodeURIComponent(i.id)}" class="btn btn-secondary full" id="editReportBtn">Edit report</a>`:canClaim?`<button id="claimBtn" class="btn btn-secondary full">Claim this item</button>`:""}<p id="claimMessage" class="form-message"></p></div></div>`;
  const cb=document.getElementById("claimBtn");
  if(cb)cb.onclick=()=>{const cur=user();if(!cur){location.href="login.html";return;}let claims=JSON.parse(localStorage.getItem("lf_claims")||"[]");if(claims.some(c=>c.itemId===i.id&&c.userEmail===cur.email))return document.getElementById("claimMessage").textContent="You have already submitted a claim.";claims.push({itemId:i.id,userEmail:cur.email,date:Date.now()});localStorage.setItem("lf_claims",JSON.stringify(claims));document.getElementById("claimMessage").textContent="Claim recorded locally. Contact the reporter to continue."};
}

async function initMine(){
  const grid=document.getElementById("myReportsGrid");if(!grid||!requireUser())return;
  const mine=getItems().filter(i=>i.reportedBy===user().email);
  clearObjectUrls();
  grid.innerHTML=mine.length?(await Promise.all(mine.map(i=>card(i,true)))).join(""):`<div class="empty-state"><div>+</div><h3>No reports yet</h3><p>Create your first lost or found report.</p><a href="report.html?type=lost" class="btn btn-primary">Create report</a></div>`;
  grid.onclick=async e=>{
    const b=e.target.closest("button");if(!b)return;
    const id=b.dataset.id,items=getItems(),currentUser=user(),idx=items.findIndex(x=>x.id===id&&x.reportedBy===currentUser?.email);if(idx<0)return;
    if(b.dataset.action==="delete"&&confirm("Delete this report?")){await deleteFile(items[idx].fileId);items.splice(idx,1);saveItems(items);initMine();}
    if(b.dataset.action==="recover"){items[idx].status="recovered";saveItems(items);initMine();}
    if(b.dataset.action==="edit")location.href=`report.html?edit=${encodeURIComponent(id)}`;
  };
}

async function initDashboard(){
  const total=document.getElementById("totalCount");if(!total)return;
  const u=user(),x=getItems();
  total.textContent=x.length;
  document.getElementById("lostCount").textContent=x.filter(i=>i.type==="lost").length;
  document.getElementById("foundCount").textContent=x.filter(i=>i.type==="found").length;
  document.getElementById("mineCount").textContent=u?x.filter(i=>i.reportedBy===u.email).length:0;
  const recent=document.getElementById("recentItems");
  if(recent){clearObjectUrls();recent.innerHTML=x.length?(await Promise.all(x.slice(0,3).map(i=>card(i)))).join(""):'<div class="empty-state"><h3>No reports yet</h3><p>Be the first to add one.</p></div>';}
}

document.addEventListener("DOMContentLoaded",async()=>{
  try{
    await Promise.all([initReport(),initItems(),initDetails(),initMine(),initDashboard()]);
  }catch(err){console.error("Initialization error",err);}
  const u=user(),name=document.getElementById("userName"),av=document.getElementById("avatar");
  if(name&&u){name.textContent=u.name.split(" ")[0];if(av)av.textContent=u.name[0].toUpperCase();}
  const logout=document.getElementById("logoutBtn");
  if(logout)logout.onclick=()=>{localStorage.removeItem("lf_currentUser");location.href="index.html"};
});
