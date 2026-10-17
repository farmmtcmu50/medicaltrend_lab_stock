const setupForm=document.getElementById('setupForm');
setupForm.elements.token.value=new URLSearchParams(location.hash.slice(1)).get('token')||'';
history.replaceState(null,'',location.pathname);
setupForm.addEventListener('submit',async event=>{
  event.preventDefault();const message=document.getElementById('setupMessage'),button=setupForm.querySelector('button');
  message.textContent='';if(setupForm.password.value!==setupForm.confirm.value){message.textContent='รหัสผ่านไม่ตรงกัน';return;}
  button.disabled=true;
  try{const response=await fetch('/api/tenant/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:setupForm.token.value,password:setupForm.password.value})});const data=await response.json();if(!response.ok)throw new Error(data.error);setupForm.reset();message.textContent='ตั้งรหัสผ่านสำเร็จ กลับหน้าเข้าสู่ระบบเพื่อเริ่มใช้งาน';}catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});
