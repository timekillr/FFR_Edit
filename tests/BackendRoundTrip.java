package io.github.timekillr.ffredit.companion;
import org.json.*;
import java.util.UUID;

/** Runs the exact Android production Endpoint/Transport against a real plugin. */
public final class BackendRoundTrip {
    private static Endpoint endpoint;
    private static String pin, token;
    private static JSONObject command(String method,JSONObject args)throws Exception{
        return Transport.request(endpoint,pin,token,"POST","/v1/command",new JSONObject().put("method",method).put("args",args).put("request_id",UUID.randomUUID().toString()));
    }
    private static void require(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        endpoint=Endpoint.parse(args[0]);pin=args[1];String code=args[2];
        JSONObject info=Transport.probe(endpoint);require(pin.equals(info.getString("fingerprint")),"Probe fingerprint");
        JSONObject paired=Transport.request(endpoint,pin,null,"POST","/v1/pair",new JSONObject().put("code",code).put("device_name","Android transport integration"));
        token=paired.getString("token");
        JSONObject state=Transport.request(endpoint,pin,token,"GET","/v1/state",null);
        JSONArray saves=state.getJSONArray("saves");require(saves.length()>0,"Discovered saves");String sid=saves.getJSONObject(0).getString("id");
        JSONObject open=command("open",new JSONObject().put("sid",sid));
        require(open.getJSONObject("backup_summary").getBoolean("current_revision_backed_up"),"Automatic backup is verified");
        String backup=open.getJSONArray("backups").getJSONObject(0).getString("id");
        JSONObject manual=command("backup",new JSONObject().put("sid",sid));require(manual.getJSONObject("backup_summary").getInt("verified")>=2,"Manual backup");
        JSONObject edit=command("commit",new JSONObject().put("sid",sid).put("revision",open.getString("revision"))
                .put("edits",new JSONArray().put(new JSONObject().put("path","Player.currentMoney").put("v","555"))).put("operations",new JSONArray()));
        boolean found=false;JSONArray fields=edit.getJSONArray("fields");for(int i=0;i<fields.length();i++)if(fields.getJSONObject(i).getString("path").equals("Player.currentMoney")){found=true;require(fields.getJSONObject(i).getString("value").equals("555"),"Saved amount");}require(found,"Money field");
        command("restore",new JSONObject().put("sid",sid).put("revision",edit.getString("revision")).put("backup_id",backup));
        try{Transport.request(endpoint,"0".repeat(64),token,"GET","/v1/state",null);throw new AssertionError("Changed pin accepted");}catch(AssertionError e){throw e;}catch(Exception expected){}
        Transport.request(endpoint,pin,token,"POST","/v1/unpair",new JSONObject());
        try{Transport.request(endpoint,pin,token,"GET","/v1/state",null);throw new AssertionError("Revoked token accepted");}catch(Transport.Failure expected){require(expected.status==401,"Revoked token status");}
        System.out.println("PASS Android production HTTPS transport: fingerprint, pairing, discovery, verified backup, edit, exact restore request, wrong-pin rejection and revocation");
    }
}
