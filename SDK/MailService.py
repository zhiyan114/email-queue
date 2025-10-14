from typing import TypedDict, Optional, Literal, Union, MutableSequence
import requests
import re

# Type Definitions #
sendMailOpt = TypedDict(
    "sendMailOpt",
    {
        "from": str,
        "to": Union[str, MutableSequence[str]],
        "replyto": Optional[Union[str, MutableSequence[str]]],
        "subject": str,
        "text": Optional[str],
        "html": Optional[str]
    })


class mailResPass(TypedDict):
    success: Literal[True]
    reqID: str
    message: str


class mailResFail(TypedDict):
    success: Literal[False]
    message: str


class mailGetResItem(TypedDict):
    id: int
    fulfilled: Optional[str]
    lasterror: Optional[str]


class mailGetRes(TypedDict):
    emails: MutableSequence[mailGetResItem]


mailResType = Union[mailResPass, mailResFail]


# Actual Interactable class object #
class MailService:
    baseUrl = "https://api.mail.zhiyan114.com"
    apiKey = ""

    def __init__(self, apiKey: str, baseURL: Optional[str] = None):
        self.apiKey = apiKey
        if (baseURL):
            self.baseUrl = baseURL[:-1] if baseURL[-1] == "/" else baseURL

    def sendMail(self, opt: sendMailOpt) -> Union[mailResType, str]:
        # General Validation
        fromField = opt.get("from", None)
        if (not fromField or not self.__validateMail(fromField)):
            raise Exception("sendMail: Invalid 'from' field")
        if (not opt.get("to", None)):
            raise Exception("sendMail: 'to' field is required")
        opt["to"] = opt["to"].split(",") if type(opt["to"]) is str else opt["to"]
        for to in opt["to"]:
            if (not self.__validateMail(to)):
                raise Exception("sendMail: Invalid 'to' field was found")
        if (not opt["subject"]):
            raise Exception("sendMail: subject is required to avoid bad email delivery")

        if (opt.get("text", None) and not opt.get("html", None)):
            raise Exception("sendMail: Missing email body (either text or html is required)")
        if (opt.get("text", None) and opt.get("html", None)):
            raise Exception("sendMail: You cannot include both text and html email body")

        optReplyTo = opt.get("replyto", None)
        if optReplyTo is not None:
            opt["replyto"] = optReplyTo.split(",") if type(optReplyTo) is str else optReplyTo
            for rt in opt["replyto"]:
                if (not self.__validateMail(rt)):
                    raise Exception("sendMail: Invalid 'replyto' field was found")

        tRes = self.__transport("/requests", "POST", opt)
        return tRes.json() if tRes.status_code in [200,422,503] else tRes.text

    def getMailStat(self, reqID: str) -> Union[mailGetRes, str]:
        tRes = self.__transport(f"/requests/{reqID}", "GET")
        return tRes.json() if tRes.status_code in [200,422,503] else tRes.text

    def __validateMail(self, input: str):
        # Check "Name <email@address.local>"
        if (re.match("^[a-zA-Z0-9 ._'`-]+ <[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}>$", input)):
            return True

        # Check "email@address.local"
        if (re.match("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$", input)):
            return True
        return False

    def __transport(self, path: str, method: str, jsonData: dict | None = None):
        header = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.apiKey}"
        }

        match method.lower():
            case "post":
                return requests.post(url=f"{self.baseUrl}{path}", headers=header, json=jsonData)
            case "get":
                return requests.get(url=f"{self.baseUrl}{path}", headers=header)
            case _:
                raise Exception("SDK Error: Invalid/Unhandled HTTP method supplied")
