from typing import TypedDict, Optional, Literal, Union, MutableSequence
import requests
import re

# Type Definitions #
sendMailOpt = TypedDict(
    "sendMailOpt",
    {
        "from": Optional[str],
        "to": Union[str, MutableSequence[str]],
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


mailResType = Union[mailResPass, mailResFail]


# Actual Interactable class object #
class MailService:
    baseUrl = "https://api.mail.zhiyan114.com"
    apiKey = ""

    def __init__(self, apiKey: str, baseURL: Optional[str] = None):
        self.apiKey = apiKey
        if (baseURL):
            self.baseUrl = baseURL[:-1] if baseURL[-1] == "/" else baseURL

    def sendMail(self, opt: sendMailOpt) -> mailResType:
        # General Validation
        if (opt["from"] and not self.__validateMail(opt["from"])):
            raise Exception("sendMail: Invalid 'from' field")
        opt["to"] = opt["to"].split(",") if type(opt["to"]) is str else opt["to"]
        for to in opt["to"]:
            if (not self.__validateMail(to)):
                raise Exception("sendMail: Invalid 'to' field was found")
        if (not opt["subject"]):
            raise Exception("sendMail: subject is required to avoid bad email delivery")

        if (not opt["text"] and not opt["html"]):
            raise Exception("sendMail: Missing email body (either text or html is required)")
        if (opt["text"] and opt["html"]):
            raise Exception("sendMail: You cannot include both text and html email body")

        return self.__transport("/requests", "POST", opt).json()

    def __validateMail(self, input: str):
        # Check "Name <email@address.local>"
        if (re.match("^[a-zA-Z0-9 ._'`-]+ <[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}>$", input)):
            return True

        # Check "email@address.local"
        if (re.match("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", input)):
            return True
        return False

    def __transport(self, path: str, method: str, jsonData: dict):
        header = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer ${self.apiKey}"
        }

        match method.lower():
            case "post":
                return requests.post(f"{self.baseUrl}{method}", headers=header, json=jsonData)
            case _:
                raise Exception("SDK Error: Invalid/Unhandled HTTP method supplied")
